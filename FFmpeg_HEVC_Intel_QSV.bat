@echo off
setlocal enabledelayedexpansion

REM 获取输入参数
set "input_file=%~1"

REM 提取输入文件所在文件夹路径
for %%F in ("%input_file%") do (
    set "input_folder=%%~dpF"
    set "input_filename=%%~nF"
)

REM 生成输出文件路径
set "original_file=%input_folder%%input_filename%.mp4"
set "output_file=%input_folder%%input_filename%_optimized.mp4"
set "output_filename=%input_folder%%input_filename%_optimized"

REM 获取原始文件大小
for /f %%i in ('ffprobe -v error -show_entries format^=size -of default^=nw^=1:nk^=1 "%original_file%"') do set "original_file_size_byte=%%i"

REM 调用 PowerShell 进行大数加法运算并向上取整
for /f %%A in ('powershell -command "[math]::Ceiling([decimal](%original_file_size_byte%) / [decimal](2000000000))"') do set "block_number=%%A"

REM 获取原始文件时长
for /f %%a in ('ffprobe -v error -show_entries format^=duration -of default^=noprint_wrappers^=1:nokey^=1 "%original_file%"') do set "original_file_duration_second=%%a"

REM 计算分段时长
for /f %%A in ('powershell -command "[math]::Ceiling([decimal](%original_file_duration_second%) / [decimal](%block_number%))"') do set "segment_duration=%%A"

REM 检测是否存在已优化的文件
if exist "%output_file%" (
    echo 已优化文件存在，跳过第一部分处理。
    goto skip_first_part
)



echo original_file_path: %original_file%
echo original_file_size_byte: %original_file_size_byte%
echo block_number: %block_number%
echo original_file_duration_second: %original_file_duration_second%
echo segment_duration: %segment_duration%

REM 第一部分：编码为 HEVC 格式
ffmpeg -init_hw_device qsv=hw -filter_hw_device hw -i "%input_file%" -c:v hevc_qsv -preset slow -global_quality 22 -movflags +faststart "%output_file%"
if errorlevel 1 (
    echo 第一部分处理失败
    goto :eof
)

:skip_first_part
echo original_file_path: %original_file%
echo original_file_size_byte: %original_file_size_byte%
echo block_number: %block_number%
echo original_file_duration_second: %original_file_duration_second%
echo segment_duration: %segment_duration%
REM 第二部分：分割文件
ffmpeg -i "%output_file%" -c copy -map 0 -segment_time %segment_duration% -f segment -reset_timestamps 1 "%output_filename%_%%03d.mp4"
if errorlevel 1 (
    echo 第二部分处理失败
    goto :eof
)

echo 处理完成
pause