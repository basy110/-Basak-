import React from 'react';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Ban, BarChart3, Building2, Bus, Calendar, Check,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Contact, Copy, CreditCard, Download, ExternalLink, Eye, EyeOff,
  Filter, GraduationCap, GripVertical, HelpCircle, Home, Image, Info, KeyRound, Lock, LogOut, Mail, MapPin, Megaphone, Menu,
  MoreVertical, Palette, PanelRight, Pencil, Phone, Plus, Power, Receipt, RefreshCw, Route, ScanLine, Search, Send, Shield,
  SlidersHorizontal, Smartphone, Trash2, TrendingUp, Undo2, Upload, User, Users, Wand2, WifiOff, X, ZoomIn, type LucideIcon,
} from 'lucide-react';

/**
 * The kit's icon names (docs/admin-redesign/generator/kit.mjs) on lucide.
 * In RTL «fwd» (the direction of reading) points left and «back» points right.
 */
const ICONS = {
  home: Home, receipt: Receipt, route: Route, key: KeyRound, user: User, users: Users, scan: ScanLine, megaphone: Megaphone,
  card: CreditCard, chart: BarChart3, calendar: Calendar, clock: Clock, idcard: Contact, building: Building2, school: GraduationCap,
  sliders: SlidersHorizontal, smartphone: Smartphone, shield: Shield, bus: Bus, menu: Menu, search: Search, zoom: ZoomIn,
  filter: Filter, sort: ArrowUpDown, dots: MoreVertical, fwd: ChevronLeft, back: ChevronRight, arrowBack: ArrowRight,
  arrowFwd: ArrowLeft, down: ChevronDown, up: ChevronUp, aup: ArrowUp, adown: ArrowDown, x: X, check: Check, plus: Plus,
  alert: AlertTriangle, info: Info, help: HelpCircle, logout: LogOut, trash: Trash2, undo: Undo2, pencil: Pencil, copy: Copy,
  eye: Eye, eyeOff: EyeOff, lock: Lock, phone: Phone, mail: Mail, image: Image, pin: MapPin, wifiOff: WifiOff, refresh: RefreshCw,
  external: ExternalLink, power: Power, panel: PanelRight, grip: GripVertical, wand: Wand2, upload: Upload, download: Download,
  ban: Ban, send: Send, palette: Palette, trend: TrendingUp,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export const Icon: React.FC<{ name: IconName; size?: number; stroke?: number; className?: string }> = ({ name, size = 20, stroke = 1.75, className }) => {
  const C = ICONS[name];
  return <C width={size} height={size} strokeWidth={stroke} aria-hidden="true" className={`flex-none ${className ?? ''}`} />;
};
