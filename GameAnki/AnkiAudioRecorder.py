import time
import requests
from requests.exceptions import RequestException
import tempfile
import os
import pyaudiowpatch as pyaudio
import av
import numpy as np
import queue
import subprocess  # For alternative conversion
import wave  # For alternative conversion


class AnkiAudioRecorder:
    def __init__(self):
        self.is_recording = False
        self.audio_data = []
        self.sample_rate = None
        self.channels = None
        self.chunk_size = 1024
        self.audio_stream = None
        self.pyaudio_instance = None
        self.recording_thread = None
        self.target_device = None
        self.audio_queue = queue.Queue()
        self.anki_media_path = None  # Cache for Anki media path

    def _get_default_wasapi_loopback_device(self):
        """获取默认的WASAPI loopback设备"""
        try:
            wasapi_info = self.pyaudio_instance.get_host_api_info_by_type(
                pyaudio.paWASAPI
            )
        except OSError:
            raise Exception("WASAPI不可用，无法录制系统音频")

        default_speakers = self.pyaudio_instance.get_device_info_by_index(
            wasapi_info["defaultOutputDevice"]
        )

        if not default_speakers["isLoopbackDevice"]:
            for loopback in self.pyaudio_instance.get_loopback_device_info_generator():
                if default_speakers["name"] in loopback["name"]:
                    return loopback
            # Fallback: try any loopback device if specific one not found
            for loopback in self.pyaudio_instance.get_loopback_device_info_generator():
                print(
                    f"Warning: Default loopback not found. Using first available: {loopback['name']}"
                )
                return loopback
            raise Exception("未找到loopback设备，无法录制系统音频")
        return default_speakers

    def start_recording(self):
        """开始录音"""
        if self.is_recording:
            print("已经在录音中...")
            return

        print("开始录制系统音频...")
        self.is_recording = True

        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
            except queue.Empty:
                break
        self.audio_data = []

        try:
            self.pyaudio_instance = pyaudio.PyAudio()
            self.target_device = self._get_default_wasapi_loopback_device()
            self.sample_rate = int(self.target_device["defaultSampleRate"])
            self.channels = self.target_device["maxInputChannels"]

            print(f"使用设备: {self.target_device['name']}")
            print(f"采样率: {self.sample_rate}, 声道数: {self.channels}")

            self.audio_stream = self.pyaudio_instance.open(
                format=pyaudio.paFloat32,
                channels=self.channels,
                rate=self.sample_rate,
                input=True,
                input_device_index=self.target_device["index"],
                frames_per_buffer=self.chunk_size,
                stream_callback=self._audio_callback,
            )
            print("录音已开始...")
        except Exception as e:
            print(f"初始化录音失败: {e}")
            self.is_recording = False
            self._cleanup()

    def _audio_callback(self, in_data, frame_count, time_info, status):
        if self.is_recording:
            self.audio_queue.put(in_data)
        return (in_data, pyaudio.paContinue)

    def stop_recording_and_save(self, save_source_format=False):
        if not self.is_recording:
            print("没有正在进行的录音...")
            return

        print("停止录音...")
        self.is_recording = False
        time.sleep(0.2)  # Give callback a moment to finish

        print("收集音频数据...")
        audio_chunks = []
        while not self.audio_queue.empty():
            try:
                chunk = self.audio_queue.get_nowait()
                audio_chunks.append(chunk)
            except queue.Empty:
                break

        self._cleanup()

        if not audio_chunks:
            print("没有录音数据")
            return

        print(f"处理 {len(audio_chunks)} 个音频块...")
        audio_bytes = b"".join(audio_chunks)
        audio_array = np.frombuffer(audio_bytes, dtype=np.float32)

        if self.channels > 1:
            audio_array = audio_array.reshape(-1, self.channels)
            audio_array = np.mean(audio_array, axis=1)

        if np.max(np.abs(audio_array)) > 0:
            peak = np.max(np.abs(audio_array))
            normalization_factor = 0.95 / peak
            audio_array = audio_array * normalization_factor
        else:  # Handle silent audio
            print("录制的音频是静音的。")
            # return # Or proceed to save a silent file if desired

        print(f"音频长度: {len(audio_array) / self.sample_rate:.2f} 秒")

        # Get Anki media path once
        if not self.anki_media_path:
            self.anki_media_path = self._get_anki_media_path()

        if not self.anki_media_path:
            print("❌ 无法获取Anki媒体目录，音频文件将保存在临时目录中。")
            # Fallback to temp directory if Anki path isn't available
            # This is not ideal as Anki won't find it unless manually moved
            # Or, we could decide to simply not save if Anki path is unavailable.
            # For now, let's be explicit that it will be in temp.
            # However, the request was to save to Anki media path, so if it's not
            # available, saving to Anki will likely fail anyway.
            # Let's make it strict: if Anki media path not found, don't proceed with saving.
            print(
                "❌ 错误: 无法获取Anki媒体目录。请确保Anki正在运行且AnkiConnect已安装。"
            )
            return

        opus_filename = self._convert_to_opus(audio_array, self.anki_media_path)

        if opus_filename:
            if save_source_format:
                self._save_source_format(audio_array, self.anki_media_path)
            self._save_to_anki(opus_filename)
        else:
            print("音频转换或保存失败")

    def _cleanup(self):
        try:
            if self.audio_stream:
                if not self.audio_stream.is_stopped():
                    self.audio_stream.stop_stream()
                self.audio_stream.close()
                self.audio_stream = None
            if self.pyaudio_instance:
                self.pyaudio_instance.terminate()
                self.pyaudio_instance = None
        except Exception as e:
            print(f"清理资源时出错: {e}")

    def _get_anki_media_path(self):
        """获取Anki媒体文件夹路径"""
        if self.anki_media_path:  # Return cached path if already fetched
            return self.anki_media_path
        try:
            payload = {
                "action": "getMediaDirPath",
                "version": 6,
            }
            response = requests.post("http://127.0.0.1:8765", json=payload, timeout=5)
            response.raise_for_status()  # Raises an HTTPError for bad responses (4XX or 5XX)
            result = response.json()
            if result.get("error"):
                print(f"AnkiConnect API 错误: {result['error']}")
                return None
            path = result.get("result")
            if path and os.path.isdir(path):
                print(f"Anki媒体目录: {path}")
                self.anki_media_path = path  # Cache the path
                return path
            else:
                print(f"获取的Anki媒体路径无效: {path}")
                return None
        except RequestException as e:
            print(f"无法连接到AnkiConnect或获取媒体路径: {e}")
            print("请确保Anki正在运行并且AnkiConnect插件已安装。")
            return None
        except Exception as e:
            print(f"获取Anki媒体路径时发生未知错误: {e}")
            return None

    def _convert_to_opus(self, audio_array, base_save_path):
        """转换为opus格式并保存到指定路径"""
        try:
            timestamp = int(time.time())
            opus_filename = f"recording_{timestamp}.opus"
            # opus_path = os.path.join(tempfile.gettempdir(), opus_filename) # Old way
            opus_path = os.path.join(base_save_path, opus_filename)  # New way

            print(f"转换为Opus格式并保存到: {opus_path}")

            if self.sample_rate != 48000:
                print(
                    f"提示: Opus通常期望48kHz采样率，当前为{self.sample_rate}Hz。av库应能处理。"
                )

            # Ensure audio length is multiple of frame_size for some encoders, though av might handle it
            # For av, direct encoding of the whole array as one frame is common
            # trimmed_length = (len(audio_array) // frame_size) * frame_size
            # if trimmed_length == 0:
            #     print("音频太短，无法转换 (av)")
            #     return None
            # trimmed_audio = audio_array[:trimmed_length]
            if len(audio_array) == 0:
                print("音频数据为空，无法转换。")
                return None

            trimmed_audio = audio_array  # Use full audio array

            container = av.open(opus_path, mode="w")
            stream = container.add_stream("opus", rate=self.sample_rate)
            stream.layout = "mono"
            # stream.options = {'b:a': '64k'} # Example: set bitrate if desired

            # Create a single AudioFrame from the entire numpy array
            # Reshape to (1, N) for mono, (2, N) for stereo if needed by from_ndarray
            audio_frame_np = trimmed_audio.astype(np.float32).reshape(1, -1)
            frame = av.AudioFrame.from_ndarray(
                audio_frame_np,
                format="fltp",  # float planar
                layout="mono",
            )
            frame.sample_rate = self.sample_rate

            for packet in stream.encode(frame):
                container.mux(packet)
            # Flush encoder
            for packet in stream.encode():
                container.mux(packet)

            container.close()
            print(f"✅ Opus文件创建成功: {opus_filename} (路径: {opus_path})")
            return opus_filename  # Return only the filename for Anki tag
        except Exception as e:
            print(f"❌ 转换为Opus失败 (av): {e}")
            # Fallback to alternative method, ensuring it also saves to anki_media_path
            return self._convert_to_opus_alternative(audio_array, base_save_path)

    def _save_source_format(self, audio_array, base_save_path):
        """保存源格式（FLAC）到指定路径"""
        try:
            timestamp = int(time.time())
            flac_filename = f"recording_{timestamp}.flac"
            # flac_path = os.path.join(tempfile.gettempdir(), flac_filename) # Old way
            flac_path = os.path.join(base_save_path, flac_filename)  # New way

            print(f"保存FLAC格式到: {flac_path}")

            if len(audio_array) == 0:
                print("音频数据为空，无法保存FLAC。")
                return

            container = av.open(flac_path, mode="w")
            stream = container.add_stream("flac", rate=self.sample_rate)
            stream.layout = "mono"

            audio_frame_np = audio_array.astype(np.float32).reshape(1, -1)
            frame = av.AudioFrame.from_ndarray(
                audio_frame_np,
                format="fltp",  # float planar
                layout="mono",
            )
            frame.sample_rate = self.sample_rate

            for packet in stream.encode(frame):
                container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
            container.close()
            print(f"✅ FLAC文件创建成功: {flac_filename} (路径: {flac_path})")
        except Exception as e:
            print(f"❌ 保存FLAC失败: {e}")

    def _convert_to_opus_alternative(self, audio_array, base_save_path):
        """备用转换方法（使用ffmpeg）并保存到指定路径"""
        try:
            timestamp = int(time.time())
            # Temporary WAV still goes to system temp
            wav_temp = os.path.join(
                tempfile.gettempdir(), f"temp_audio_{timestamp}.wav"
            )
            opus_filename = f"recording_{timestamp}.opus"
            # Final Opus goes to Anki media path
            opus_path = os.path.join(base_save_path, opus_filename)

            print(f"备用方法: 转换为Opus格式并保存到: {opus_path}")

            if len(audio_array) == 0:
                print("音频数据为空，无法使用备用方法转换。")
                return None

            # 先保存为wav
            audio_int16 = (audio_array * 32767).astype(np.int16)
            with wave.open(wav_temp, "wb") as wf:
                wf.setnchannels(1)  # Mono
                wf.setsampwidth(2)  # 16-bit
                wf.setframerate(self.sample_rate)
                wf.writeframes(audio_int16.tobytes())

            # 使用ffmpeg转换
            cmd = [
                "ffmpeg",
                "-y",  # Overwrite output files without asking
                "-i",
                wav_temp,
                "-c:a",
                "libopus",
                "-b:a",
                "64k",  # Opus bitrate
                "-ar",
                str(self.sample_rate),  # Ensure sample rate matches input
                opus_path,
            ]
            # print(f"Executing FFmpeg: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True, check=False)

            if os.path.exists(wav_temp):
                os.remove(wav_temp)

            if result.returncode == 0:
                print(f"✅ 备用方法转换成功: {opus_filename} (路径: {opus_path})")
                return opus_filename  # Return only the filename
            else:
                print(f"❌ FFmpeg转换失败. 返回码: {result.returncode}")
                print(f"FFmpeg stdout: {result.stdout}")
                print(f"FFmpeg stderr: {result.stderr}")
                return None
        except FileNotFoundError:
            print("❌ FFmpeg 未找到。请确保已安装并添加到系统PATH。")
            return None
        except Exception as e:
            print(f"❌ 备用转换方法失败: {e}")
            return None

    def _save_to_anki(self, opus_filename):
        """保存到Anki (filename is just the base name, e.g., recording_123.opus)"""
        try:
            # Ensure Anki media path is known, though not directly used here for file copy
            # It's more of a pre-requisite check that we *could* save there.
            if not self.anki_media_path and not self._get_anki_media_path():
                print("❌ 无法获取Anki媒体目录，无法更新Anki卡片。")
                return

            find_notes_data = {
                "action": "findNotes",
                "version": 6,
                "params": {"query": "added:1"},  # Find notes added in the last day
            }
            response = requests.post(
                "http://127.0.0.1:8765", json=find_notes_data, timeout=5
            )
            response.raise_for_status()
            result = response.json()

            if result.get("error"):
                print(f"AnkiConnect API 错误 (findNotes): {result['error']}")
                return
            if not result.get("result"):
                print("没有找到最近添加的卡片 (added:1)")
                return

            note_ids = sorted(result["result"], reverse=True)
            latest_note_id = note_ids[0]
            print(f"找到最新卡片ID: {latest_note_id}")

            # Check if the target field exists (optional but good practice)
            note_info_data = {
                "action": "notesInfo",
                "version": 6,
                "params": {"notes": [latest_note_id]},
            }
            info_response = requests.post(
                "http://127.0.0.1:8765", json=note_info_data, timeout=5
            )
            info_response.raise_for_status()
            info_result = info_response.json()

            if info_result.get("error") or not info_result.get("result"):
                print(
                    f"无法获取卡片 {latest_note_id} 的信息: {info_result.get('error')}"
                )
                return

            target_field_name = "SentenceAudio"  # Or your desired field
            if target_field_name not in info_result["result"][0]["fields"]:
                print(
                    f"❌ 错误: 卡片 {latest_note_id} 中没有名为 '{target_field_name}' 的字段。"
                )
                print(f"可用字段: {list(info_result['result'][0]['fields'].keys())}")
                print(
                    f"请确保你的Anki笔记类型包含一个名为 '{target_field_name}' 的字段。"
                )
                return

            update_data = {
                "action": "updateNoteFields",
                "version": 6,
                "params": {
                    "note": {
                        "id": latest_note_id,
                        "fields": {target_field_name: f"[sound:{opus_filename}]"},
                    }
                },
            }
            update_response = requests.post(
                "http://127.0.0.1:8765", json=update_data, timeout=5
            )
            update_response.raise_for_status()
            update_result = update_response.json()

            if update_result.get("error") is None:
                print(
                    f"✅ 成功将音频 '{opus_filename}' 添加到Anki卡片 {latest_note_id} 的字段 '{target_field_name}'"
                )
            else:
                print(f"❌ 更新卡片失败: {update_result.get('error')}")

        except RequestException as e:
            print(f"与AnkiConnect通信失败: {e}")
            print("请确保Anki正在运行并且AnkiConnect插件已安装。")
        except Exception as e:
            print(f"❌ 保存到Anki时发生未知错误: {e}")

    def list_audio_devices(self):
        """列出所有可用的音频设备"""
        temp_p = None
        try:
            temp_p = pyaudio.PyAudio()
            print("\n=== 可用的音频设备 ===")
            for i in range(temp_p.get_device_count()):
                info = temp_p.get_device_info_by_index(i)
                print(
                    f"设备 {i}: {info['name']} - 输入声道: {info['maxInputChannels']}, 输出声道: {info['maxOutputChannels']}, 默认采样率: {info['defaultSampleRate']}"
                )

            print("\n=== WASAPI Loopback设备 ===")
            try:
                for loopback in temp_p.get_loopback_device_info_generator():
                    print(f"Loopback设备 {loopback['index']}: {loopback['name']}")
            except AttributeError:
                print(
                    "pyaudiowpatch 的 get_loopback_device_info_generator 可能不可用或pyaudio版本不支持。"
                )
            except Exception as e:
                print(f"无法获取loopback设备信息: {e}")
        finally:
            if temp_p:
                temp_p.terminate()


# 全局录音器实例
recorder = AnkiAudioRecorder()
recording_state = False


def OnHotKeyClicked():
    """热键回调函数"""
    global recording_state

    if not recording_state:
        recorder.start_recording()
        # recording_state is set inside start_recording upon success
        recording_state = recorder.is_recording
    else:
        # Ensure save_source_format=True/False is your desired setting
        recorder.stop_recording_and_save(save_source_format=True)
        recording_state = False  # Assume stop always sets it to false

    print(f"录音状态: {'录音中' if recording_state else '已停止'}")


if __name__ == "__main__":
    print("系统音频录音器已准备就绪。")
    print("按回车键开始/停止录音，输入'list'查看设备，输入'quit'退出。")
    print("请确保 Anki 正在运行并且 AnkiConnect 插件已安装。")

    # Initial check for Anki media path
    # recorder._get_anki_media_path() # Can be called here to inform user early if path is not found

    while True:
        try:
            user_input = input()
            if user_input.lower() == "quit":
                if recording_state:
                    print("正在停止录音并清理...")
                    recorder.stop_recording_and_save(
                        save_source_format=False
                    )  # Or true, depending on preference
                    recording_state = False
                break
            elif user_input.lower() == "list":
                recorder.list_audio_devices()
            else:  # Assume Enter key or any other input toggles recording
                OnHotKeyClicked()
        except KeyboardInterrupt:
            print("\n检测到Ctrl+C，正在退出...")
            if recording_state:
                print("正在停止录音并清理...")
                recorder.stop_recording_and_save(save_source_format=False)
            break
        except Exception as e:
            print(f"主循环发生错误: {e}")
            # Potentially try to clean up recorder if an error occurs mid-recording
            if recorder.is_recording:
                recorder.is_recording = False
                recorder._cleanup()
            recording_state = False

    print("程序已退出。")
