import { HttpError } from '../../shared/http-error.js';
import { validInstitutionalEmail } from '../../modules/auth/auth.validators.js';
import type { SisIdentity } from '../../modules/auth/auth.types.js';
import type { AcademicIdentity } from '../../modules/profile/profile.types.js';

function malformed(): never {
  throw new HttpError(
    502,
    'SIS_INVALID_RESPONSE',
    'The institutional service returned an invalid response.',
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) malformed();
  return value as Record<string, unknown>;
}
function name(value: unknown, max = 160): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /\p{Cc}/u.test(value)
  )
    malformed();
  return value.trim().replace(/\s+/gu, ' ');
}
function department(value: unknown) {
  const v = object(value);
  return { name: name(v.name), faculty: name(object(v.faculty).name) };
}
// Deliberately selects profile metadata; no grades, schedules, hire dates or raw SIS payload.
export function parseSisIdentity(value: unknown): SisIdentity {
  const v = object(value);
  if (
    typeof v.userId !== 'string' ||
    !v.userId ||
    v.userId.length > 128 ||
    /[\s\p{Cc}]/u.test(v.userId) ||
    !validInstitutionalEmail(v.email)
  )
    malformed();
  if (
    !Array.isArray(v.roles) ||
    v.roles.length < 1 ||
    v.roles.length > 16 ||
    v.roles.some(
      (r) => typeof r !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(r),
    )
  )
    malformed();
  const academic: AcademicIdentity = {
    campus: null,
    admissionYear: null,
    programs: [],
    departments: [],
  };
  if (v.student != null) {
    const student = object(v.student);
    if (student.primaryCampus != null)
      academic.campus = name(object(student.primaryCampus).name);
    if (student.admissionYear != null) {
      if (
        typeof student.admissionYear !== 'number' ||
        !Number.isInteger(student.admissionYear) ||
        student.admissionYear < 1900 ||
        student.admissionYear > 2200
      )
        malformed();
      academic.admissionYear = student.admissionYear;
    }
    if (!Array.isArray(student.programs) || student.programs.length > 16)
      malformed();
    academic.programs = student.programs.map((value) => {
      const program = object(value);
      const d = department(program.department);
      return {
        name: name(program.name),
        department: d.name,
        faculty: d.faculty,
      };
    });
  }
  for (const role of ['instructor', 'advisor']) {
    if (v[role] != null) {
      const d = department(object(v[role]).department);
      if (
        !academic.departments.some(
          (existing) =>
            existing.name === d.name && existing.faculty === d.faculty,
        )
      )
        academic.departments.push(d);
    }
  }
  return {
    userId: v.userId,
    email: v.email,
    firstName: name(v.firstName, 100),
    lastName: name(v.lastName, 100),
    roles: [...new Set(v.roles as string[])].sort(),
    academic,
  };
}
