import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TierBadge } from '../../components/TierBadge';

describe('TierBadge', () => {
  it('renders dash for null tier', () => {
    render(<TierBadge tier={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders Healthy label for healthy tier', () => {
    render(<TierBadge tier="healthy" />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders Watch label for watch tier', () => {
    render(<TierBadge tier="watch" />);
    expect(screen.getByText('Watch')).toBeInTheDocument();
  });

  it('renders At Risk label for at-risk tier', () => {
    render(<TierBadge tier="at-risk" />);
    expect(screen.getByText('At Risk')).toBeInTheDocument();
  });

  it('renders Critical label for critical tier', () => {
    render(<TierBadge tier="critical" />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('renders Unmapped label for unmapped tier', () => {
    render(<TierBadge tier="unmapped" />);
    expect(screen.getByText('Unmapped')).toBeInTheDocument();
  });
});
