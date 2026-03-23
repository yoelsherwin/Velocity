import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useQuitWarning } from '../hooks/useQuitWarning';

describe('useQuitWarning', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it('test_registers_beforeunload_when_processes_running', () => {
    renderHook(() => useQuitWarning(true));

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function),
    );
  });

  it('test_does_not_register_when_no_processes_running', () => {
    renderHook(() => useQuitWarning(false));

    const beforeunloadCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === 'beforeunload',
    );
    expect(beforeunloadCalls).toHaveLength(0);
  });

  it('test_handler_sets_returnValue_and_prevents_default', () => {
    renderHook(() => useQuitWarning(true));

    const handler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'beforeunload',
    )?.[1] as EventListener;

    expect(handler).toBeDefined();

    const event = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(event, 'returnValue', {
      writable: true,
      value: '',
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    handler(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect((event as BeforeUnloadEvent).returnValue).toBe('');
  });

  it('test_removes_handler_when_processes_stop', () => {
    const { rerender } = renderHook(
      ({ active }) => useQuitWarning(active),
      { initialProps: { active: true } },
    );

    const handler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'beforeunload',
    )?.[1];

    expect(handler).toBeDefined();

    // Rerender with no running processes
    rerender({ active: false });

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'beforeunload',
      handler,
    );
  });

  it('test_removes_handler_on_unmount', () => {
    const { unmount } = renderHook(() => useQuitWarning(true));

    const handler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'beforeunload',
    )?.[1];

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'beforeunload',
      handler,
    );
  });

  it('test_toggles_handler_correctly_across_multiple_rerenders', () => {
    const { rerender } = renderHook(
      ({ active }) => useQuitWarning(active),
      { initialProps: { active: false } },
    );

    // Initially no handler
    let beforeunloadCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === 'beforeunload',
    );
    expect(beforeunloadCalls).toHaveLength(0);

    // Start running
    rerender({ active: true });
    beforeunloadCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === 'beforeunload',
    );
    expect(beforeunloadCalls).toHaveLength(1);

    // Stop running
    rerender({ active: false });
    const removeCalls = removeEventListenerSpy.mock.calls.filter(
      (call) => call[0] === 'beforeunload',
    );
    expect(removeCalls).toHaveLength(1);
  });
});
