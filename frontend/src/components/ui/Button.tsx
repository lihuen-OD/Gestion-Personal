import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

type ButtonVariant = "primary" | "subtle" | "danger" | "ghost";

type ButtonOwnProps = { variant?: ButtonVariant; icon?: LucideIcon; loading?: boolean };

type ButtonAsButtonProps = ButtonOwnProps & ButtonHTMLAttributes<HTMLButtonElement> & { to?: undefined };
type ButtonAsLinkProps = ButtonOwnProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

export function Button({ variant = "subtle", icon: Icon, loading, className = "", children, to, ...rest }: ButtonAsButtonProps | ButtonAsLinkProps) {
  const classes = `button ${variant} ${className}`.trim();
  if (to) {
    return (
      <Link to={to} className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {Icon && <Icon size={16} />}
        {children}
      </Link>
    );
  }
  const { disabled, ...buttonRest } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button className={classes} disabled={disabled || loading} {...buttonRest}>
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}
