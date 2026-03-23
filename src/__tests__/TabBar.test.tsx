import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TabBar from '../components/layout/TabBar';
import { Tab } from '../lib/types';

const makeTabs = (count: number): Tab[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `tab-${i + 1}`,
    title: `Terminal ${i + 1}`,
    shellType: 'powershell' as const,
    paneRoot: { type: 'leaf' as const, id: `pane-${i + 1}` },
    focusedPaneId: `pane-${i + 1}`,
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

  it('test_tab_has_draggable_attribute', () => {
    const tabs = makeTabs(3);
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
        onReorderTabs={vi.fn()}
      />,
    );
    const tab1 = screen.getByTestId('tab-button-tab-1');
    const tab2 = screen.getByTestId('tab-button-tab-2');
    const tab3 = screen.getByTestId('tab-button-tab-3');
    expect(tab1).toHaveAttribute('draggable', 'true');
    expect(tab2).toHaveAttribute('draggable', 'true');
    expect(tab3).toHaveAttribute('draggable', 'true');
  });

  it('test_drag_start_sets_data', () => {
    const tabs = makeTabs(2);
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
        onReorderTabs={vi.fn()}
      />,
    );
    const tab1 = screen.getByTestId('tab-button-tab-1');
    const setData = vi.fn();
    fireEvent.dragStart(tab1, {
      dataTransfer: { setData, effectAllowed: '' },
    });
    expect(setData).toHaveBeenCalledWith('text/plain', '0');
  });

  it('test_drop_reorders_tabs', () => {
    const tabs = makeTabs(3);
    const onReorderTabs = vi.fn();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
        onReorderTabs={onReorderTabs}
      />,
    );
    // Drag tab-1 (index 0) and drop on tab-3 (index 2)
    const tab1 = screen.getByTestId('tab-button-tab-1');
    const tab3 = screen.getByTestId('tab-button-tab-3');
    fireEvent.dragStart(tab1, {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    fireEvent.drop(tab3, {
      dataTransfer: { getData: () => '0' },
    });
    expect(onReorderTabs).toHaveBeenCalledWith(0, 2);
  });

  it('test_active_tab_preserved_after_reorder', () => {
    const tabs = makeTabs(3);
    const onReorderTabs = vi.fn();
    // Active tab is tab-2 (index 1)
    const { rerender } = render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-2"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
        onReorderTabs={onReorderTabs}
      />,
    );
    // Simulate drag tab-1 to position 2
    const tab1 = screen.getByTestId('tab-button-tab-1');
    const tab3 = screen.getByTestId('tab-button-tab-3');
    fireEvent.dragStart(tab1, {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    fireEvent.drop(tab3, {
      dataTransfer: { getData: () => '0' },
    });
    // Simulate the reorder that TabManager would perform
    const reorderedTabs = [tabs[1], tabs[2], tabs[0]];
    rerender(
      <TabBar
        tabs={reorderedTabs}
        activeTabId="tab-2"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
        onReorderTabs={onReorderTabs}
      />,
    );
    // Active tab (tab-2) should still be highlighted
    const activeBtn = screen.getByTestId('tab-button-tab-2');
    expect(activeBtn).toHaveClass('tab-button-active');
  });

  it('test_dragging_tab_has_opacity', () => {
    const tabs = makeTabs(2);
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
        onReorderTabs={vi.fn()}
      />,
    );
    const tab1 = screen.getByTestId('tab-button-tab-1');
    fireEvent.dragStart(tab1, {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    expect(tab1).toHaveClass('tab-dragging');
    fireEvent.dragEnd(tab1);
    expect(tab1).not.toHaveClass('tab-dragging');
  });

  it('test_TabBar_has_settings_button', () => {
    const tabs = makeTabs(1);
    const onOpenSettings = vi.fn();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );
    const settingsBtn = screen.getByTestId('settings-button');
    expect(settingsBtn).toBeInTheDocument();
    fireEvent.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
