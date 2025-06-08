from HotKeyManager import start_hotkey_listener
from AnkiAudioRecorder import OnHotKeyClicked as AudioRecorder
from WindowCapture import OnHotKeyClicked as Screenshot
from config import Config


if __name__ == "__main__":
    try:
        cfg = Config()
        listeners = []
        listeners.append(
            start_hotkey_listener(
                {cfg.getScreenshotHotkey()},
                lambda: Screenshot(cfg.getScreenshotQuantity()),
            )
        )
        listeners.append(
            start_hotkey_listener({cfg.getAudioRecorderHotkey()}, AudioRecorder)
        )

        # 等待所有监听线程结束
        for listener in listeners:
            listener.join()

    except KeyboardInterrupt:
        print("\n程序被用户中断")
    except Exception as e:
        print(f"程序运行时发生错误: {e}")
    finally:
        print("程序退出。")
