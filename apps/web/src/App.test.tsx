import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('zeigt Produktnamen und Überschrift', () => {
    render(<App />);
    expect(screen.getByText('LastPlan')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Grundgerüst' })).toBeTruthy();
  });
});
