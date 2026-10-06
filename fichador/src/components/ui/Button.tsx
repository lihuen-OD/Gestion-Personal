import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

// Copia de frontend/src/components/ui/Button.tsx sin la variante `to` (link
// de react-router-dom): el fichador standalone no tiene router y nunca la
// usó. Mismo markup y mismas clases, así se ve igual que en el admin.
type ButtonVariant = "primary" | "subtle" | "danger" | "ghost";

type ButtonProps = { variant?: ButtonVariant; icon?: LucideIcon; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = "subtle", icon: Icon, loading, className = "", children, disabled, ...rest }: ButtonProps) {
  const classes = `button ${variant} ${className}`.trim();
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}
