@echo off
setlocal enabledelayedexpansion

REM Get the input parameters
set "input_file=%~1"

REM Extract the input file's folder path, filename, and extension
for %%F in ("%input_file%") do (
   set "input_folder=%%~dpF"
   set "input_filename=%%~nF"
   set "input_extension=%%~xF"  REM Get the extension (e.g., .mp4)
)

set block_number=0

REM Generate the output file path using the original extension
set "original_file=%input_folder%%input_filename%%input_extension%"
set "output_filename=%input_folder%%input_filename%"

REM Get the original file size
for /f %%i in ('ffprobe -v error -show_entries format^=size -of default^=nw^=1:nk^=1 "%original_file%"') do set "original_file_size_byte=%%i"

REM Check if ffprobe succeeded in getting size
if not defined original_file_size_byte (
   echo Error: Could not get file size for "%original_file%". Check if the file exists and ffprobe is working.
   pause
   exit /b 1
)

REM Call PowerShell for big number addition and take the ceiling
for /f %%A in ('powershell -command "[math]::Ceiling([decimal](%original_file_size_byte%) / [decimal](2000000000))"') do set "block_number=%%A"

REM Get the original file duration
for /f %%a in ('ffprobe -v error -show_entries format^=duration -of default^=noprint_wrappers^=1:nokey^=1 "%original_file%"') do set "original_file_duration_second=%%a"

REM Check if ffprobe succeeded in getting duration
if not defined original_file_duration_second (
   echo Error: Could not get file duration for "%original_file%". Check if the file exists and ffprobe is working.
   pause
   exit /b 1
)

REM Calculate the segment duration
REM Add a check to prevent division by zero if block_number is somehow 0
if "%block_number%"=="0" set block_number=1
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
   REM No need to exit if block_number is 1, just don't split. Let's adjust the logic slightly.
   echo File size does not require splitting based on the 2GB threshold.
   pause
   exit /b 0  REM Exit successfully without splitting
)

REM Split the file using the original extension for output parts
ffmpeg -i "%original_file%" -c copy -map 0 -segment_time %segment_duration% -f segment -reset_timestamps 1 -movflags +faststart "%output_filename%_%%03d%input_extension%"

if errorlevel 1 (
   echo Splitting process failed. Check ffmpeg output for details.
   pause
   goto :eof
)

echo Processing completed
pause
