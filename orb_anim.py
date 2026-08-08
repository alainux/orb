import numpy as np
import time
import os

def get_braille(pattern):
    return chr(0x2800 + pattern)

def sphere_and_waves(width, height, time_val):
    output = []
    aspect_ratio = width / height
    
    for y in range(0, height, 4):
        row = ""
        for x in range(0, width, 2):
            pattern = 0
            for dy in range(4):
                for dx in range(2):
                    nx = (x + dx) / width * 2 - 1
                    ny = (y + dy) / height * 2 - 1
                    nx *= aspect_ratio
                    
                    # Sphere
                    dist = nx*nx + ny*ny
                    is_sphere = dist < 0.3
                    
                    # Waves
                    wave = np.sin(10 * (nx**2 + ny**2) - 5 * time_val)
                    is_wave = abs(wave) < 0.1 and dist > 0.3 and dist < 0.9

                    # Raytracing/shading (simple normal-based)
                    if is_sphere:
                        normal_z = np.sqrt(max(0, 0.3 - dist))
                        shading = normal_z / np.sqrt(0.3)
                        # Simple dither-like shading
                        if shading < 0.4 and (x+dx+y+dy)%2==0: is_sphere = False

                    if is_sphere or is_wave:
                        # Map dx, dy to braille dots
                        dot_map = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]
                        pattern |= dot_map[dy][dx]
            row += get_braille(pattern)
        output.append(row)
    return "\n".join(output)

try:
    width, height = os.get_terminal_size()
except OSError:
    width, height = 80, 40

start_time = time.time()
# Run for a bit and clear screen at end
for _ in range(50):
    print("\033[H", end="") # Cursor to top
    print(sphere_and_waves(width, height, time.time() - start_time))
    time.sleep(0.05)
print("\033[2J") # Clear screen at end
