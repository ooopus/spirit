@echo off
setlocal enabledelayedexpansion

REM Get the input parameters
set "input_file=%~1"

REM Extract the input file's folder path
for %%F in ("%input_file%") do (
   set "input_folder=%%~dpF"
   set "input_filename=%%~nF"
)

set block_number=0

REM Generate the output file path
set "original_file=%input_folder%%input_filename%.mp4"
set "output_filename=%input_folder%%input_filename%"

REM Get the original file size
for /f %%i in ('ffprobe -v error -show_entries format^=size -of default^=nw^=1:nk^=1 "%original_file%"') do set "original_file_size_byte=%%i"

REM Call PowerShell for big number addition and take the ceiling
for /f %%A in ('powershell -command "[math]::Ceiling([decimal](%original_file_size_byte%) / [decimal](2000000000))"') do set "block_number=%%A"

REM Get the original file duration
for /f %%a in ('ffprobe -v error -show_entries format^=duration -of default^=noprint_wrappers^=1:nokey^=1 "%original_file%"') do set "original_file_duration_second=%%a"

REM Calculate the segment duration
for /f %%A in ('powershell -command "[math]::Ceiling([decimal](%original_file_duration_second%) / [decimal](%block_number%))"') do set "segment_duration=%%A"

echo original_file_path: %original_file%
echo original_file_size_byte: %original_file_size_byte%
echo block_number: %block_number%
echo original_file_duration_second: %original_file_duration_second%
echo segment_duration: %segment_duration%

if %block_number% gtr 1 (
   echo block_number: %block_number% is greater than 1, continue executing the script
) else (
   echo block_number: %block_number% is less than or equal to 1, the script exits
   exit /b 1
)

REM Second part: Split the file
ffmpeg -i "%original_file%" -c copy -map 0 -segment_time %segment_duration% -f segment -reset_timestamps 1 -movflags +faststart "%output_filename%_%%03d.mp4"

if errorlevel 1 (
   echo Second part processing failed
   goto :eof
)

echo Processing completed
pause
