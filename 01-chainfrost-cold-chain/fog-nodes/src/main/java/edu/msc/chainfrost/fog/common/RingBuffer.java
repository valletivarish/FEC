package edu.msc.chainfrost.fog.common;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * Fixed-capacity circular buffer. Oldest element is dropped on overflow so the
 * dispatch fallback queue never grows unbounded during a prolonged outage.
 */
public class RingBuffer<T> {

    private final int capacity;
    private final Deque<T> items = new ArrayDeque<>();

    public RingBuffer(int capacity) {
        if (capacity <= 0) {
            throw new IllegalArgumentException("capacity must be positive");
        }
        this.capacity = capacity;
    }

    public synchronized void offer(T item) {
        if (items.size() == capacity) {
            items.removeFirst();
        }
        items.addLast(item);
    }

    public synchronized T poll() {
        return items.pollFirst();
    }

    public synchronized List<T> drainAll() {
        List<T> drained = new ArrayList<>(items);
        items.clear();
        return drained;
    }

    public synchronized int size() {
        return items.size();
    }

    public synchronized boolean isEmpty() {
        return items.isEmpty();
    }
}
