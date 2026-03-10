# DMR Project Notes

## Pi SSH Access

Until 2026-03-15, the dmr Pi is available at:
- Host: 174.31.80.238
- Port: 24
- User: pi
- SSH key: ~/.ssh/pi_dmr

Example: `ssh -p 24 -i ~/.ssh/pi_dmr pi@174.31.80.238`

## Common Operations

### Check if Pi camera stream is running
```bash
ssh -p 24 -i ~/.ssh/pi_dmr pi@174.31.80.238 "pgrep -a gst-launch"
```

### Restart Pi camera stream
```bash
ssh -p 24 -i ~/.ssh/pi_dmr pi@174.31.80.238 "pkill gst-launch; sleep 1; nohup gst-launch-1.0 libcamerasrc ! 'video/x-raw,width=640,height=480,framerate=30/1' ! queue ! videoconvert ! v4l2h264enc extra-controls='controls,repeat_sequence_header=1' ! 'video/x-h264,level=(string)4' ! h264parse config-interval=-1 ! queue ! rtspclientsink location=rtsp://198.199.80.228:8554/robot1 > /tmp/gst-stream.log 2>&1 &"
```

### Check MediaMTX for active streams
```bash
ssh root@198.199.80.228 "journalctl -u mediamtx -n 20 --no-pager"
```

### FFmpeg test stream on relay (for testing without Pi)
```bash
ssh root@198.199.80.228 "ffmpeg -re -f lavfi -i testsrc=size=640x480:rate=30,drawtext=text='%{localtime}':fontsize=48:fontcolor=white:x=10:y=10 -c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -level 3.1 -pix_fmt yuv420p -g 30 -f rtsp rtsp://localhost:8554/teststream"
```
