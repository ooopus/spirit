import time
import requests
import cv2
import os
from requests.exceptions import RequestException
from windows_capture import WindowsCapture, Frame, InternalCaptureControl
import win32gui
from PIL import Image
import pillow_avif  # noqa: F401 # type: ignore
import re

# 配置选项
SAVE_ORIGINAL_PNG = False  # 是否保存原始PNG图片 (renamed for clarity)
ANKI_CONNECT_URL = "http://127.0.0.1:8765"

# TEMP_DIR is not strictly needed for final AVIF/PNG if Anki path is found,
# but can be a fallback or for truly temporary operations if any.
# For now, primary save target is Anki media dir.
# TEMP_DIR = tempfile.gettempdir() # Kept for sanitize_filename example if needed elsewhere


class WindowCapture:
    def __init__(self):
        self.captured_frame: Frame | None = None
        self.capture_complete = False
        self.anki_media_path: str | None = None  # Cache for Anki media path

    def get_active_window_title(self) -> str | None:
        """获取当前活动窗口的标题"""
        try:
            hwnd = win32gui.GetForegroundWindow()
            window_title = win32gui.GetWindowText(hwnd)
            return window_title if window_title else None
        except Exception as e:
            print(f"获取活动窗口标题时出错: {e}")
            return None

    def capture_window(self, window_name: str) -> Frame | None:
        """捕获指定窗口的内容"""
        self.captured_frame = None
        self.capture_complete = False

        try:
            capture = WindowsCapture(
                cursor_capture=False,
                draw_border=False,
                window_name=window_name,
            )
        except Exception as e:  # Catching potential init errors for WindowsCapture
            print(
                f"初始化WindowsCapture失败，可能窗口 '{window_name}' 未找到或无效: {e}"
            )
            return None

        @capture.event
        def on_frame_arrived(frame: Frame, capture_control: InternalCaptureControl):
            self.captured_frame = frame
            self.capture_complete = True
            capture_control.stop()

        @capture.event
        def on_closed():
            # print("Capture session closed") # Can be noisy
            pass

        try:
            control = capture.start_free_threaded()
            timeout = 5
            start_time = time.time()
            while not self.capture_complete and (time.time() - start_time) < timeout:
                time.sleep(0.05)  # Shorter sleep for faster response

            if not self.capture_complete:
                print(f"捕获超时，窗口 '{window_name}' 可能未发送帧。")

            control.stop()
            control.wait()  # Ensure capture thread finishes

            return self.captured_frame

        except Exception as e:
            print(f"捕获窗口 '{window_name}' 时出错: {e}")
            if "control" in locals() and control:
                try:
                    control.stop()  # Attempt to stop if running
                    control.wait()
                except Exception as e_stop:
                    print(f"停止捕获控制时出错: {e_stop}")
            return None

    def _get_anki_media_path(self) -> str | None:
        """获取Anki媒体文件夹路径"""
        if self.anki_media_path:  # Return cached path
            return self.anki_media_path
        try:
            payload = {"action": "getMediaDirPath", "version": 6}
            response = requests.post(ANKI_CONNECT_URL, json=payload, timeout=5)
            response.raise_for_status()
            result = response.json()
            if result.get("error"):
                print(f"AnkiConnect API 错误 (getMediaDirPath): {result['error']}")
                return None
            path = result.get("result")
            if path and os.path.isdir(path):
                print(f"Anki媒体目录: {path}")
                self.anki_media_path = path  # Cache the path
                return path
            else:
                print(f"获取的Anki媒体路径无效或非目录: {path}")
                return None
        except RequestException as e:
            print(f"无法连接到AnkiConnect或获取媒体路径: {e}")
            print("请确保Anki正在运行并且AnkiConnect插件已安装。")
            return None
        except Exception as e:
            print(f"获取Anki媒体路径时发生未知错误: {e}")
            return None

    def save_frame_as_avif(
        self, frame: Frame, filename_base: str, quality: int
    ) -> tuple[str | None, str | None]:
        """将帧保存为AVIF格式到Anki媒体目录，可选保存原始PNG。"""
        anki_path = self._get_anki_media_path()
        if not anki_path:
            print("❌ 无法获取Anki媒体目录。图片将不会被保存。")
            return None, None

        try:
            bgr_frame_buffer = frame.convert_to_bgr().frame_buffer

            png_full_path = None
            if SAVE_ORIGINAL_PNG:
                png_filename = f"{filename_base}.png"
                png_full_path = os.path.join(anki_path, png_filename)
                cv2.imwrite(png_full_path, bgr_frame_buffer)
                print(f"原始PNG图片已保存到Anki媒体目录: {png_filename}")

            rgb_array = cv2.cvtColor(bgr_frame_buffer, cv2.COLOR_BGR2RGB)
            pil_image = Image.fromarray(rgb_array)

            avif_filename = f"{filename_base}.avif"
            avif_full_path = os.path.join(anki_path, avif_filename)
            pil_image.save(
                avif_full_path, format="AVIF", quality=quality
            )  # Adjust quality as needed
            print(f"AVIF图片已保存到Anki媒体目录: {avif_filename}")

            # Return only the filenames for Anki reference
            return avif_filename, (png_filename if png_full_path else None)

        except Exception as e:
            print(f"保存图片到Anki媒体目录时出错: {e}")
            return None, None

    def anki_connect_request(
        self, action: str, params: dict | None = None
    ) -> dict | None:
        """发送AnkiConnect请求"""
        if params is None:
            params = {}
        payload = {"action": action, "version": 6, "params": params}
        try:
            response = requests.post(
                ANKI_CONNECT_URL,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=5,
            )
            response.raise_for_status()
            return response.json()
        except RequestException as e:
            print(f"AnkiConnect请求 '{action}' 失败: {e}")
            return None
        except Exception as e:  # Catch other potential errors like JSON decoding
            print(f"AnkiConnect请求 '{action}' 中发生意外错误: {e}")
            return None

    def get_latest_note_id(self) -> int | None:
        """获取最新添加的笔记ID"""
        result = self.anki_connect_request("findNotes", {"query": "added:1"})
        if result and result.get("result"):
            note_ids = sorted([int(nid) for nid in result["result"]], reverse=True)
            return note_ids[0] if note_ids else None
        if result and result.get("error"):
            print(f"查找笔记时AnkiConnect返回错误: {result.get('error')}")
        return None

    def update_note_with_image(
        self, note_id: int, image_filename: str, field_name: str = "Picture"
    ) -> bool:
        """更新笔记，添加图片到指定字段"""
        img_html = f'<img src="{image_filename}">'
        params = {"note": {"id": note_id, "fields": {field_name: img_html}}}

        # Optional: Check if field exists before updating
        note_info = self.anki_connect_request("notesInfo", {"notes": [note_id]})
        if not (
            note_info
            and note_info.get("result")
            and note_info["result"][0]["fields"].get(field_name) is not None
        ):
            print(f"警告: 字段 '{field_name}' 在笔记ID {note_id} 的类型中可能不存在。")
            available_fields = (
                list(note_info["result"][0]["fields"].keys())
                if (note_info and note_info.get("result"))
                else "未知"
            )
            print(f"可用字段: {available_fields}")
            # Decide if you want to proceed or return False here
            # For now, let's allow the update attempt.

        result = self.anki_connect_request("updateNoteFields", params)
        if result and result.get("error") is None:
            print(
                f"✅ 成功更新笔记 {note_id}，在字段 '{field_name}' 添加了图片: {image_filename}"
            )
            return True
        else:
            error_msg = result.get("error") if result else "未知错误"
            print(f"❌ 更新笔记 {note_id} 失败: {error_msg}")
            return False


def sanitize_filename(filename: str) -> str:
    """
    清理文件名中的非法字符，使其适用于Windows系统。
    """
    # 替换掉Windows不允许的字符为下划线
    illegal_chars = r'[\\/:*?"<>|]'
    sanitized = re.sub(illegal_chars, "_", filename)
    # 移除其他可能导致问题的字符，如控制字符
    sanitized = re.sub(r"[\x00-\x1f\x7f]", "", sanitized)
    # 替换连续的下划线或空格为一个下划线
    sanitized = re.sub(r"[_ ]+", "_", sanitized)
    # 去除前后下划线和空格
    sanitized = sanitized.strip("_ ")
    # 避免文件名以点结尾
    if sanitized.endswith("."):
        sanitized = sanitized[:-1] + "_"
    if not sanitized:
        sanitized = "unnamed_capture"
    # 限制最大长度 (OS dependent, 255 is a safe bet for components)
    max_len = 200  # Keep it well below 255 to account for extensions, timestamps etc.
    return sanitized[:max_len]


def OnHotKeyClicked(quality: int = 80):
    """热键回调函数"""
    print(f"📸 截屏热键触发: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    capture_handler = WindowCapture()

    window_title = capture_handler.get_active_window_title()
    if not window_title:
        print("❌ 无法获取活动窗口标题。")
        return

    print(f"🎯 准备截取窗口: '{window_title}'")

    frame = capture_handler.capture_window(window_title)
    if not frame:
        print("❌ 截屏失败。")
        return

    timestamp = int(time.time())
    # Sanitize window_title *before* using it in filename_base
    sanitized_title = sanitize_filename(window_title)
    filename_base = f"{sanitized_title}_{timestamp}"
    # Final sanitization for the whole base if needed, though sanitize_filename should handle most.
    filename_base = sanitize_filename(filename_base)

    # save_frame_as_avif now returns just the filenames (not full paths)
    avif_filename, png_filename = capture_handler.save_frame_as_avif(
        frame, filename_base, quality
    )

    if not avif_filename:
        print("❌ 保存图片失败。")
        return

    latest_note_id = capture_handler.get_latest_note_id()
    if latest_note_id is None:  # Check for None explicitly
        print("❌ 无法找到最新的Anki笔记。")
        return

    # Use the AVIF filename (which is now just the name, not path) for Anki
    # Ensure you have a field named "Picture" in your Anki note type.
    success = capture_handler.update_note_with_image(
        latest_note_id, avif_filename, field_name="Picture"
    )

    if success:
        print(
            f"🎉 截屏完成！图片 '{avif_filename}' 已添加到Anki笔记 {latest_note_id}。"
        )
        if png_filename and SAVE_ORIGINAL_PNG:
            print(f"   原始PNG '{png_filename}' 也已保存到Anki媒体目录。")
    else:
        print("❌ 添加图片到Anki失败。")


if __name__ == "__main__":
    print("Anki 窗口截图工具已准备就绪。")
    print("图片将尝试保存到Anki媒体目录。确保Anki和AnkiConnect正在运行。")
    print("按回车键触发截图，或在脚本中集成到热键系统。")
    while True:
        inp = input("按回车键截图，输入 'q' 退出: ")
        if inp.lower() == "q":
            break
        OnHotKeyClicked()
    print("程序退出。")
