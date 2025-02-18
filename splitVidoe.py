import os
import sys
import subprocess
import math




def get_file_size(file_path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=size', '-of', 'default=nw=1:nk=1', file_path],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return int(result.stdout.strip())




def get_file_duration(file_path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file_path],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return float(result.stdout.strip())




def split_video(input_file):
    input_folder = os.path.dirname(input_file)
    input_filename = os.path.splitext(os.path.basename(input_file))[0]
    
    original_file = f"{input_folder}/{input_filename}.mp4"
    output_filename = f"{input_folder}/{input_filename}"


    original_file_size_byte = get_file_size(original_file)
    block_number = math.ceil(original_file_size_byte / 2000000000)


    original_file_duration_second = get_file_duration(original_file)
    segment_duration = math.ceil(original_file_duration_second / block_number)


    print(f"Processing: {original_file}")
    print(f"original_file_size_byte: {original_file_size_byte}")
    print(f"block_number: {block_number}")
    print(f"original_file_duration_second: {original_file_duration_second}")
    print(f"segment_duration: {segment_duration}")


    if block_number > 1:
        print(f"block_number: {block_number} is greater than 1, continue executing the script")
    else:
        print(f"block_number: {block_number} is less than or equal to 1, the script exits")
        return


    # Split the file
    split_command = [
        'ffmpeg', '-i', original_file, '-c', 'copy', '-map', '0',
        '-segment_time', str(segment_duration), '-f', 'segment',
        '-reset_timestamps', '1', '-movflags', '+faststart',
        f"{output_filename}_%03d.mp4"
    ]


    result = subprocess.run(split_command)
    if result.returncode != 0:
        print("Second part processing failed")
        return


    print("Processing completed for:", original_file)




if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python script.py <input_file1> <input_file2> ... <input_fileN>")
        sys.exit(1)


    # Process each input file
    for input_file in sys.argv[1:]:
        split_video(input_file)
