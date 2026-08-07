package playback

import "sync"

type Queue struct {
	mu     sync.Mutex
	chunks [][]byte
	offset int
	bytes  int
}

func (q *Queue) Write(p []byte) {
	if len(p) == 0 {
		return
	}
	cp := append([]byte(nil), p...)
	q.mu.Lock()
	q.chunks = append(q.chunks, cp)
	q.bytes += len(cp)
	q.mu.Unlock()
}

func (q *Queue) ReadInto(dst []byte) int {
	q.mu.Lock()
	defer q.mu.Unlock()
	written := 0
	for written < len(dst) && len(q.chunks) > 0 {
		head := q.chunks[0]
		n := copy(dst[written:], head[q.offset:])
		written += n
		q.offset += n
		q.bytes -= n
		if q.offset == len(head) {
			q.chunks[0] = nil
			q.chunks = q.chunks[1:]
			q.offset = 0
		}
	}
	return written
}

func (q *Queue) Clear()   { q.mu.Lock(); q.chunks = nil; q.offset = 0; q.bytes = 0; q.mu.Unlock() }
func (q *Queue) Len() int { q.mu.Lock(); defer q.mu.Unlock(); return q.bytes }
