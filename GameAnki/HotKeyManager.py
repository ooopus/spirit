from pynput import keyboard
import threading
from WindowCapture import OnHotKeyClicked as Screenshot
from AnkiAudioRecorder import OnHotKeyClicked as AudioRecorder


class HotkeyManager:
    def __init__(self, hotkey, target):
        self.current_keys = set()
        self.hotkey_pressed = False
        self.hotkey = hotkey
        self.target = target

    def on_press(self, key):
        """按键按下事件处理"""
        self.current_keys.add(key)

        # 检查是否按下了热键组合
        if self.hotkey.issubset(self.current_keys) and not self.hotkey_pressed:
            self.hotkey_pressed = True
            # 在新线程中执行截图，避免阻塞键盘监听
            threading.Thread(target=self.trigger, daemon=True).start()

    def on_release(self, key):
        """按键释放事件处理"""
        try:
            self.current_keys.remove(key)
        except KeyError:
            pass

        # 重置热键状态
        if not self.hotkey.issubset(self.current_keys):
            self.hotkey_pressed = False

        # ESC键退出程序
        if key == keyboard.Key.esc:
            print("检测到ESC键，程序即将退出...")
            return False

    def trigger(self):
        """触发线程函数"""
        try:
            self.target()
        except Exception as e:
            print(f"截图过程中发生错误: {e}")


def start_hotkey_listener(hotkey, target):
    """启动热键监听"""
    hotkey_manager = HotkeyManager(hotkey, target)

    print("🔥 热键监听已启动!")

    listener = keyboard.Listener(
        on_press=hotkey_manager.on_press, on_release=hotkey_manager.on_release
    )
    listener.start()
    return listener


if __name__ == "__main__":
    try:
        listeners = []
        listeners.append(start_hotkey_listener({keyboard.Key.caps_lock}, Screenshot))
        listeners.append(start_hotkey_listener({keyboard.Key.tab}, AudioRecorder))

        # 等待所有监听线程结束
        for listener in listeners:
            listener.join()

    except KeyboardInterrupt:
        print("\n程序被用户中断")
    except Exception as e:
        print(f"程序运行时发生错误: {e}")
    finally:
        print("程序退出。")
