import tomllib
import os
from pynput import keyboard
import shutil


def load_config(file_path: str = None) -> dict:
    """
    Load configuration from a TOML file.
    If no file_path is provided, load 'config.toml' from the current directory.
    If config.toml does not exist, copy config.toml.example to config.toml.

    Args:
        file_path (str, optional): Path to the TOML configuration file.

    Returns:
        dict: Parsed configuration as a dictionary.
    """

    if file_path is None:
        # Get the directory of the current file and use 'config.toml' in that directory
        base_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(base_dir, "config.toml")
        example_path = os.path.join(base_dir, "config.toml.example")
        if not os.path.exists(file_path):
            if os.path.exists(example_path):
                shutil.copy(example_path, file_path)
                print(
                    "未检测到 config.toml，已自动复制 config.toml.example 为 config.toml"
                )
            else:
                raise FileNotFoundError(
                    "未找到 config.toml 或 config.toml.example，请手动创建配置文件。"
                )
    with open(file_path, "rb") as f:
        config = tomllib.load(f)
    return config


class Config:
    """
    Configuration class to hold application settings.
    """

    def __init__(self, config_file: str = None):
        self.config = load_config(config_file)

    def getScreenshotHotkey(self):
        """
        Get the hotkey for taking a screenshot.
        """
        key = eval(self.config["HotKey"]["ScreenShot"])
        return key

    def getAudioRecorderHotkey(self):
        """
        Get the hotkey for starting the audio recorder.
        """
        key = eval(self.config["HotKey"]["AudioRecord"])
        return key

    def getScreenshotQuantity(self):
        """
        Get the quantity of screenshots to take.

        Returns:
            int: The configured screenshot quantity.
        """
        q = self.config["Quality"]["ScreenShot"]
        return q
