"""Read one pixel from Chrome's 8-bit RGB/RGBA PNG screenshots using the standard library."""
import struct
import zlib

def pixel_at(path, x, y):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    offset, image_data = 8, []
    while offset < len(data):
        length = struct.unpack('>I', data[offset:offset+4])[0]
        kind = data[offset+4:offset+8]
        content = data[offset+8:offset+8+length]
        if kind == b'IHDR':
            width, height, bits, color, _, _, interlaced = struct.unpack('>IIBBBBB', content)
            assert bits == 8 and color in (2, 6) and interlaced == 0
        if kind == b'IDAT':
            image_data.append(content)
        offset += length + 12
    assert 0 <= x < width and 0 <= y < height
    channels = 3 if color == 2 else 4
    stride = width * channels
    decoded = zlib.decompress(b''.join(image_data))
    previous = bytearray(stride)
    for row in range(y + 1):
        start = row * (stride + 1)
        mode = decoded[start]
        current = bytearray(decoded[start+1:start+1+stride])
        for index in range(stride):
            left = current[index-channels] if index >= channels else 0
            above = previous[index]
            corner = previous[index-channels] if index >= channels else 0
            if mode == 0: predictor = 0
            elif mode == 1: predictor = left
            elif mode == 2: predictor = above
            elif mode == 3: predictor = (left + above) // 2
            else:
                assert mode == 4
                estimate = left + above - corner
                predictor = min((left, above, corner), key=lambda value: abs(estimate-value))
            current[index] = (current[index] + predictor) & 255
        previous = current
    return list(previous[x*channels:x*channels+channels])
