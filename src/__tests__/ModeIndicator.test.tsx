import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ModeIndicator from '../components/editor/ModeIndicator';

describe('ModeIndicator Component', () => {
  it('test_renders_cli_badge', () => {
    render(<ModeIndicator intent="cli" confidence="high" onToggle={vi.fn()} />);
    const indicator = screen.getByTestId('mode-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toContain('CLI');
  });

  it('test_renders_ai_badge', () => {
    render(<ModeIndicator intent="natural_language" confidence="high" onToggle={vi.fn()} />);
    const indicator = screen.getByTestId('mode-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toContain('AI');
    // Should have the AI-specific class for accent styling
    expect(indicator).toHaveClass('mode-indicator-ai');
  });

  it('test_renders_uncertain_cli', () => {
    render(<ModeIndicator intent="cli" confidence="low" onToggle={vi.fn()} />);
    const indicator = screen.getByTestId('mode-indicator');
    expect(indicator.textContent).toContain('CLI?');
    expect(indicator).toHaveClass('mode-indicator-uncertain');
  });

  it('test_renders_uncertain_ai', () => {
    render(<ModeIndicator intent="natural_language" confidence="low" onToggle={vi.fn()} />);
    const indicator = screen.getByTestId('mode-indicator');
    expect(indicator.textContent).toContain('AI?');
    expect(indicator).toHaveClass('mode-indicator-uncertain');
  });

  it('test_click_calls_onToggle', () => {
    const onToggle = vi.fn();
    render(<ModeIndicator intent="cli" confidence="high" onToggle={onToggle} />);
    const indicator = screen.getByTestId('mode-indicator');
    fireEvent.click(indicator);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('test_disabled_prevents_click', () => {
    const onToggle = vi.fn();
    render(<ModeIndicator intent="cli" confidence="high" onToggle={onToggle} disabled />);
    const indicator = screen.getByTestId('mode-indicator');
    fireEvent.click(indicator);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('test_cli_mode_does_not_have_ai_class', () => {
    render(<ModeIndicator intent="cli" confidence="high" onToggle={vi.fn()} />);
    const indicator = screen.getByTestId('mode-indicator');
    expect(indicator).not.toHaveClass('mode-indicator-ai');
    expect(indicator).toHaveClass('mode-indicator-cli');
  });

  it('test_high_confidence_does_not_have_uncertain_class', () => {
    render(<ModeIndicator intent="cli" confidence="high" onToggle={vi.fn()} />);
    const indicator = screen.getByTestId('mode-indicator');
    expect(indicator).not.toHaveClass('mode-indicator-uncertain');
  });
});
