import React from 'react';
import { LineWizard } from '../components/lines/LineWizard';

/** «خط جديد» in five steps; nothing is saved until the last one (docs/canvas/AdmLineNew1..5). */
export const LineNewPage: React.FC = () => <LineWizard mode="new" />;
