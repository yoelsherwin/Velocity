import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue('test-session-id'),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import App from "../App";

test("renders App with terminal", () => {
  render(<App />);
  expect(screen.getByTestId("terminal-output")).toBeInTheDocument();
});

test("renders terminal input", () => {
  render(<App />);
  expect(screen.getByTestId("terminal-input")).toBeInTheDocument();
});
