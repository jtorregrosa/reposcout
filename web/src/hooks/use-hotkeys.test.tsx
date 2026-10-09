import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useHotkeys } from './use-hotkeys';

function Harness({ onNext, onPalette, dialog = false }: { onNext: () => void; onPalette: () => void; dialog?: boolean }) {
  useHotkeys({ next: onNext, palette: onPalette }, { chord: ['palette'] });
  return (
    <>
      <input aria-label="field" />
      <button type="button">press</button>
      {dialog ? <div role="dialog">open</div> : null}
    </>
  );
}

const setup = (dialog = false) => {
  const onNext = vi.fn();
  const onPalette = vi.fn();
  render(<Harness onNext={onNext} onPalette={onPalette} dialog={dialog} />);
  return { onNext, onPalette, user: userEvent.setup() };
};

describe('keyboard shortcuts', () => {
  it('fire a plain key outside fields', async () => {
    const { onNext, user } = setup();
    await user.keyboard('j');
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('leave a plain key typed in a field alone', async () => {
    const { onNext, user } = setup();
    await user.click(screen.getByRole('textbox', { name: 'field' }));
    await user.keyboard('j');
    expect(onNext).not.toHaveBeenCalled();
  });

  it('leave a plain key alone while a dialog is open', async () => {
    const { onNext, user } = setup(true);
    await user.keyboard('j');
    expect(onNext).not.toHaveBeenCalled();
  });

  it('leave a plain key with a modifier alone', async () => {
    const { onNext, user } = setup();
    await user.keyboard('{Control>}j{/Control}');
    expect(onNext).not.toHaveBeenCalled();
  });

  it('fire a chord even in a field, and never without its modifier', async () => {
    const { onPalette, user } = setup();
    await user.keyboard('k');
    expect(onPalette).not.toHaveBeenCalled();
    await user.click(screen.getByRole('textbox', { name: 'field' }));
    await user.keyboard('{Control>}k{/Control}');
    expect(onPalette).toHaveBeenCalledOnce();
  });
});
