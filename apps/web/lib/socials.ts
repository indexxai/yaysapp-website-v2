import type { SocialNetwork } from '@yays/shared';
import type { IconName } from './icons';

export const SOCIAL: Record<SocialNetwork | 'facebook', { name: string; icon: IconName; fill: string }> = {
  facebook: { name: 'Facebook', icon: 'facebook', fill: '#1877f2' },
  x: { name: 'X', icon: 'x', fill: '#1f1a16' }, instagram: { name: 'Instagram', icon: 'instagram', fill: '#b24a7a' }, tiktok: { name: 'TikTok', icon: 'tiktok', fill: '#1f1a16' },
  youtube: { name: 'YouTube', icon: 'youtube', fill: '#c85a45' }, linkedin: { name: 'LinkedIn', icon: 'linkedin', fill: '#2f5f9e' }, telegram: { name: 'Telegram', icon: 'telegram', fill: '#2f7fb8' },
};
