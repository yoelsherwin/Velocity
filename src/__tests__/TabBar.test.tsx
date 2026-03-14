import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TabBar from '../components/layout/TabBar';
import { Tab } from '../lib/types';

const makeTabs = (count: number): Tab[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `tab-${i + 1}`,
    title: `Terminal ${i + 1}`,
    shellType: 'powershell' as const,
  }));

describe('TabBar', () => {
  it('test_renders_tabs', () => {
    const tabs = makeTabs(2);
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );
    expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    expect(screen.getByText('Terminal 2')).toBeInTheDocument();
  });

  it('test_active_tab_highlighted', () => {
    const tabs = makeTabs(2);
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-2"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );
    const activeButton = screen.getByTestId('tab-button-tab-2');
    expect(activeButton).toHaveClass('tab-button-active');

    const inactiveButton = screen.getByTestId('tab-button-tab-1');
    expect(inactiveButton).not.toHaveClass('tab-button-active');
  });

  it('test_click_tab_calls_onSelectTab', () => {
    const tabs = makeTabs(2);
    const onSelectTab = vi.fn();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={onSelectTab}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('tab-button-tab-2'));
    expect(onSelectTab).toHaveBeenCalledWith('tab-2');
  });

  it('test_close_button_calls_onCloseTab', () => {
    const tabs = makeTabs(2);
    const onCloseTab = vi.fn();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={onCloseTab}
        onNewTab={vi.fn()}
      />,
    );
    const closeButtons = screen.getAllByTestId(/^tab-close-/);
    // Click close on the second tab
    fireEvent.click(screen.getByTestId('tab-close-tab-2'));
    expect(onCloseTab).toHaveBeenCalledWith('tab-2');
  });

  it('test_close_hidden_on_single_tab', () => {
    const tabs = makeTabs(1);
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('tab-close-tab-1')).not.toBeInTheDocument();
  });

  it('test_new_tab_button_calls_onNewTab', () => {
    const tabs = makeTabs(1);
    const onNewTab = vi.fn();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={onNewTab}
      />,
    );
    fireEvent.click(screen.getByTestId('tab-new-button'));
    expect(onNewTab).toHaveBeenCalledTimes(1);
  });
});
