export function validateName(name: string): { isValid: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { isValid: false, error: "Full Name is required." };
  }
  if (trimmed.length > 300) {
    return { isValid: false, error: "Full Name cannot exceed 300 characters." };
  }
  if (/^[^a-zA-Z]+$/.test(trimmed)) {
    return { isValid: false, error: "Full Name must contain valid alphabetic characters and cannot be numbers or special characters only." };
  }
  if (!/^[a-zA-Z\s'\-.]+$/.test(trimmed)) {
    return { isValid: false, error: "Full Name contains invalid special characters." };
  }
  return { isValid: true };
}

export function validateEmail(email: string): { isValid: boolean; error?: string } {
  const trimmed = email.trim();
  if (!trimmed) {
    return { isValid: false, error: "Email address is required." };
  }
  if (/\.\./.test(trimmed)) {
    return { isValid: false, error: "Email address cannot contain consecutive dots." };
  }
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(trimmed)) {
    return { isValid: false, error: "Please enter a valid email address." };
  }
  return { isValid: true };
}

export function validatePassword(password: string): { isValid: boolean; error?: string } {
  if (!password) {
    return { isValid: false, error: "Password is required." };
  }
  if (password.length < 8) {
    return { isValid: false, error: "Password must be at least 8 characters long." };
  }
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, error: "Password must contain at least one uppercase letter (A-Z)." };
  }
  if (!/[a-z]/.test(password)) {
    return { isValid: false, error: "Password must contain at least one lowercase letter (a-z)." };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, error: "Password must contain at least one number (0-9)." };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { isValid: false, error: "Password must contain at least one special character." };
  }
  return { isValid: true };
}

export function validatePhone(phone: string, required: boolean = false): { isValid: boolean; error?: string } {
  const trimmed = phone.trim();
  if (!trimmed) {
    if (required) return { isValid: false, error: "Phone number is required." };
    return { isValid: true };
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length !== 10) {
    return { isValid: false, error: "Phone number must contain exactly 10 digits." };
  }
  if (/[^\d\s+\-()]/.test(trimmed)) {
    return { isValid: false, error: "Phone number contains invalid characters." };
  }
  return { isValid: true };
}

export function validateNonSpecialOnly(text: string, fieldName: string, required: boolean = false): { isValid: boolean; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    if (required) return { isValid: false, error: `${fieldName} is required.` };
    return { isValid: true };
  }
  if (/^[^a-zA-Z0-9]+$/.test(trimmed)) {
    return { isValid: false, error: `${fieldName} cannot contain only special characters.` };
  }
  return { isValid: true };
}
