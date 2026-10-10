import React from 'react';
import { PageHeader } from '../ui/Layout';

/** Older pages' header, drawn as the new page header until each page is rebuilt. */
export const Topbar: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => <PageHeader title={title} sub={subtitle} />;
