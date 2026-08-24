import type { InputHTMLAttributes } from "react";
import { Search } from "lucide-react";

export function SearchInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`search-field ${className}`.trim()}>
      <Search size={17} />
      <input type="text" {...rest} />
    </label>
  );
}
