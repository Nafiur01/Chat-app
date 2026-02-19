import cv2 as cv 
import numpy as np 
import asyncio
import os
import time
import subprocess
import threading
 

def video_processing_v2(video_path, stop_event=None, output_dir='hls_output'):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    cap = cv.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error: OpenCV could not open video source {video_path}")
        return

    fps = cap.get(cv.CAP_PROP_FPS)
    if fps <= 0:
        print("Warning: FPS is 0 or less, defaulting to 30")
        fps = 30
    
    width = int(cap.get(cv.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv.CAP_PROP_FRAME_HEIGHT))
    
    if width == 0 or height == 0:
        print(f"Error: Invalid dimensions {width}x{height}")
        cap.release()
        return

    print(f"Video Info: {width}x{height} @ {fps} FPS")
    hls_process = hls_conversion(width, height, int(fps), output_dir)

    try:
        frame_count = 0
        print("Entering processing loop...")
        while stop_event is None or not stop_event.is_set():
            ret, frame = cap.read()
            
            if not ret:          
                print(f"End of stream or read error at frame {frame_count}. Exiting loop.")
                break

            cv.putText(frame, f"FPS: {round(fps,2)}", (10, 30), cv.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

            try:
                hls_process.stdin.write(frame.tobytes())
                frame_count += 1
                if frame_count % 30 == 0:
                    print(f"Piping frame {frame_count} to FFmpeg...")
            except (BrokenPipeError, OSError) as e:
                print(f"FFmpeg process closed or stdin unreachable: {e}")
                break

            time.sleep(1 / fps)
    except Exception as e:
        print(f"Critical error in video processing loop: {e}")
    finally:
        cap.release()
        if hls_process.poll() is None:
            print(f"Closing FFmpeg stdin (Total frames sent: {frame_count})...")
            try:
                hls_process.stdin.close()
                hls_process.wait(timeout=5)
            except Exception as e:
                print(f"Error closing FFmpeg: {e}")
        print(f"Video processing task finished.")


def hls_conversion(width, height, fps, output_dir) -> subprocess.Popen:
    hls_playlist = os.path.join(output_dir, 'stream.m3u8')
    print(f"FFmpeg command using output playlist: {hls_playlist}")
    
    command = [
        'ffmpeg',
        '-y', 
        '-f', 'rawvideo',
        '-vcodec', 'rawvideo',
        '-pix_fmt', 'bgr24', 
        '-s', f'{width}x{height}',
        '-r', str(fps),
        '-i', '-', 
        '-c:v', 'libx264', 
        '-pix_fmt', 'yuv420p',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-g', str(fps * 2), 
        '-hls_time', '1',    
        '-hls_list_size', '0', 
        '-hls_flags', 'delete_segments', 
        hls_playlist
    ]

    print(f"Running FFmpeg: {' '.join(command)}")
    # We don't capture stderr to PIPE here because we want it to show up in the terminal for the user/us to see directly
    # but we could if we wanted to log it specifically. 
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    return process


