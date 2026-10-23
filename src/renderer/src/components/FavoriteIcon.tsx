import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Atom,
  BookOpen,
  Bookmark,
  Briefcase,
  Bug,
  Building2,
  Calculator,
  Calendar,
  Camera,
  Car,
  ChartBar,
  CircuitBoard,
  Clipboard,
  Clock,
  Cloud,
  Code,
  Coffee,
  Cpu,
  Database,
  Download,
  Factory,
  FileSpreadsheet,
  FileText,
  Film,
  Flag,
  FlaskConical,
  Folder,
  FolderGit2,
  Gamepad2,
  Gift,
  Globe,
  GraduationCap,
  HardDrive,
  Heart,
  Home,
  Image,
  Key,
  Landmark,
  Laptop,
  Leaf,
  Lightbulb,
  Lock,
  Mail,
  MapPin,
  Monitor,
  Music,
  Network,
  Package,
  Palette,
  PenTool,
  Phone,
  Plane,
  Presentation,
  Printer,
  Receipt,
  Rocket,
  Router,
  Server,
  Settings,
  Shield,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  Tag,
  Target,
  Terminal,
  Trophy,
  Truck,
  User,
  Users,
  Wallet,
  Wifi,
  Wrench,
  Zap
} from 'lucide-react'

/** Icons offered for favorites and groups (stored as "lucide:<name>"). */
export const FAVORITE_ICONS: Record<string, LucideIcon> = {
  Star, Folder, Home, Briefcase, Building2, Factory, Users, User, FileText, FileSpreadsheet, Presentation, Receipt,
  Wallet, Landmark, Calculator, ChartBar, Calendar, Clock, Mail, Phone, Download, Archive, Package, Truck,
  ShoppingCart, Code, Terminal, FolderGit2, Bug, Cpu, CircuitBoard, Server, Database, Network, Router, Wifi, Cloud,
  HardDrive, Monitor, Laptop, Smartphone, Printer, Settings, Wrench, Zap, FlaskConical, Atom, Rocket, Lightbulb,
  Target, Flag, Tag, Bookmark, Trophy, Shield, Lock, Key, Globe, MapPin, Plane, Car, BookOpen, GraduationCap,
  PenTool, Palette, Image, Camera, Film, Music, Gamepad2, Coffee, Leaf, Heart, Gift, Sparkles, Clipboard
}

export const EMOJI_SUGGESTIONS = ['📁', '⭐', '🏠', '💼', '🏭', '🧪', '🔧', '💡', '🚀', '📊', '🧾', '💶', '📅', '📦', '🖥️', '☁️', '🔒', '🎨', '📷', '🎵', '❤️', '🔥', '✅', '📌']

/** Text and background colours offered in menus (plus a custom colour picker). */
export const FAVORITE_COLORS: { name: string; value: string }[] = [
  { name: 'Red', value: '#ff5f57' },
  { name: 'Orange', value: '#ff9f0a' },
  { name: 'Yellow', value: '#ffd60a' },
  { name: 'Green', value: '#32d74b' },
  { name: 'Teal', value: '#2ec4b6' },
  { name: 'Blue', value: '#0a84ff' },
  { name: 'Indigo', value: '#5e5ce6' },
  { name: 'Purple', value: '#bf5af2' },
  { name: 'Pink', value: '#ff375f' },
  { name: 'Brown', value: '#a2845e' },
  { name: 'Gray', value: '#98989d' },
  { name: 'White', value: '#ffffff' },
  { name: 'Black', value: '#1c1c1e' }
]

/** Background colours are applied translucent, so text stays readable in both themes. */
export function backgroundCss(color: string | undefined): string | undefined {
  return color ? `color-mix(in srgb, ${color} 26%, transparent)` : undefined
}

export function FavoriteIconView({ icon, fallback: Fallback, size = 14, color }: { icon?: string; fallback: LucideIcon; size?: number; color?: string }) {
  if (icon?.startsWith('emoji:')) {
    return (
      <span className="fav-emoji" style={{ fontSize: size, width: size + 2 }}>
        {icon.slice(6)}
      </span>
    )
  }
  const Icon = (icon?.startsWith('lucide:') && FAVORITE_ICONS[icon.slice(7)]) || Fallback
  return <Icon size={size} className="fav-icon" style={color ? { color } : undefined} />
}
