import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import GitContext from '../components/editor/GitContext';

describe('GitContext Component', () => {
  it('test_git_context_renders_branch', () => {
    render(<GitContext gitInfo={{ branch: 'main', is_dirty: false, ahead: 0, behind: 0 }} />);
    const context = screen.getByTestId('git-context');
    expect(context).toBeInTheDocument();
    const branch = screen.getByTestId('git-branch');
    expect(branch.textContent).toBe('[main]');
  });

  it('test_git_context_clean_indicator', () => {
    render(<GitContext gitInfo={{ branch: 'main', is_dirty: false, ahead: 0, behind: 0 }} />);
    const status = screen.getByTestId('git-status');
    expect(status.textContent).toBe('\u2713');
    expect(status).toHaveClass('git-status-clean');
  });

  it('test_git_context_dirty_indicator', () => {
    render(<GitContext gitInfo={{ branch: 'main', is_dirty: true, ahead: 0, behind: 0 }} />);
    const status = screen.getByTestId('git-status');
    expect(status.textContent).toBe('\u25CF');
    expect(status).toHaveClass('git-status-dirty');
  });

  it('test_git_context_ahead_behind', () => {
    render(<GitContext gitInfo={{ branch: 'feature/x', is_dirty: true, ahead: 2, behind: 1 }} />);
    const ahead = screen.getByTestId('git-ahead');
    expect(ahead.textContent).toBe('\u21912');
    const behind = screen.getByTestId('git-behind');
    expect(behind.textContent).toBe('\u21931');
  });

  it('test_git_context_hidden_when_no_git', () => {
    const { container } = render(<GitContext gitInfo={null} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByTestId('git-context')).not.toBeInTheDocument();
  });

  it('test_git_context_no_ahead_behind_when_zero', () => {
    render(<GitContext gitInfo={{ branch: 'main', is_dirty: false, ahead: 0, behind: 0 }} />);
    expect(screen.queryByTestId('git-ahead')).not.toBeInTheDocument();
    expect(screen.queryByTestId('git-behind')).not.toBeInTheDocument();
  });

  it('test_git_context_shows_only_ahead', () => {
    render(<GitContext gitInfo={{ branch: 'main', is_dirty: false, ahead: 5, behind: 0 }} />);
    expect(screen.getByTestId('git-ahead').textContent).toBe('\u21915');
    expect(screen.queryByTestId('git-behind')).not.toBeInTheDocument();
  });

  it('test_git_context_shows_only_behind', () => {
    render(<GitContext gitInfo={{ branch: 'main', is_dirty: false, ahead: 0, behind: 3 }} />);
    expect(screen.queryByTestId('git-ahead')).not.toBeInTheDocument();
    expect(screen.getByTestId('git-behind').textContent).toBe('\u21933');
  });
});
