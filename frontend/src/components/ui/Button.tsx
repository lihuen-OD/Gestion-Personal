import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

type ButtonVariant = "primary" | "subtle" | "danger" | "ghost";

export function Button({ variant = "subtle", icon: Icon, loading, className = "", disabled, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: LucideIcon; loading?: boolean }) {
  return <button className={`button ${variant} ${className}`.trim()} disabled={disabled || loading} {...rest}>{Icon && <Icon size={16} />}{children}</button>;
}
