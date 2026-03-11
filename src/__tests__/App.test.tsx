import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "../App";

test("renders Velocity heading", () => {
  render(<App />);
  expect(screen.getByText("Velocity")).toBeInTheDocument();
});

test("renders subtitle", () => {
  render(<App />);
  expect(screen.getByText("Modern Terminal for Windows")).toBeInTheDocument();
});
