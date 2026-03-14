import { render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock('../lib/pty', () => ({
  createSession: vi.fn().mockResolvedValue('test-session-id'),
  writeToSession: vi.fn().mockResolvedValue(undefined),
  closeSession: vi.fn().mockResolvedValue(undefined),
  startReading: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import App from "../App";

test("renders App with terminal", async () => {
  render(<App />);
  await waitFor(() => {
    expect(screen.getByTestId("terminal-output")).toBeInTheDocument();
  });
});

test("renders terminal input", async () => {
  render(<App />);
  await waitFor(() => {
    expect(screen.getByTestId("terminal-input")).toBeInTheDocument();
  });
});

test("renders tab bar", async () => {
  render(<App />);
  await waitFor(() => {
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument();
  });
});
