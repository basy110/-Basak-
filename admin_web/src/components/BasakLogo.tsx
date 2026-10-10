import React from 'react';
import basakLogo from '../assets/basak-logo.png';

/** The circular BASAK app icon, shared with the mobile app. */
export const BasakLogo: React.FC<{ className?: string }> = ({ className = 'h-10 w-10' }) => (
  <img src={basakLogo} alt="باصك" draggable={false}
    className={`${className} flex-none rounded-full object-cover shadow-md shadow-teal/20`} />
);
