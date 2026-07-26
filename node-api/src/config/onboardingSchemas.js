// Static onboarding-form schema definitions, ported verbatim from
// python-service's profile.py. Purely a client-rendering contract — the
// backend never validates submitted values against these (matching python's
// original behavior; see profile.service.js#saveOwn).
const { ROLES } = require('./constants');

// python-service's ROLE_TO_PORTAL used college_admin/recruiter, which map to
// node-api's institution_admin/hr — see roleMapping.js.
const ROLE_TO_PORTAL = {
  [ROLES.HR]: 'hr',
  [ROLES.INSTITUTION_ADMIN]: 'institutional',
  [ROLES.SUPER_ADMIN]: 'institutional',
  [ROLES.FACULTY]: 'faculty',
};

const COUNTRY_OPTIONS = [
  { label: 'India', value: 'IN' },
  { label: 'United States', value: 'US' },
  { label: 'United Kingdom', value: 'UK' },
  { label: 'United Arab Emirates', value: 'AE' },
  { label: 'Singapore', value: 'SG' },
];

const COMMON_SECTION = {
  id: 'preferences',
  title: 'Preferences',
  description: 'General settings for your account',
  fields: [
    {
      name: 'timezone', label: 'Timezone', type: 'select', required: true,
      options: [
        { label: '(GMT+5:30) India Standard Time', value: 'Asia/Kolkata' },
        { label: '(GMT+0:00) UTC', value: 'UTC' },
        { label: '(GMT-5:00) Eastern Time', value: 'America/New_York' },
        { label: '(GMT+4:00) Gulf Standard Time', value: 'Asia/Dubai' },
      ],
    },
    {
      name: 'language', label: 'Language', type: 'select', required: true,
      options: [
        { label: 'English', value: 'en' },
        { label: 'Hindi', value: 'hi' },
        { label: 'Tamil', value: 'ta' },
        { label: 'Arabic', value: 'ar' },
      ],
    },
    {
      name: 'profilePhoto', label: 'Profile Photo', type: 'file', required: false,
      accept: 'image/*', helpText: 'Optional. PNG or JPG, up to 5MB.',
    },
    {
      name: 'signature', label: 'Signature Upload', type: 'file', required: false,
      accept: 'image/*', helpText: 'Optional. Used on generated documents.',
    },
  ],
};

const SCHEMAS = {
  hr: {
    portal: 'hr',
    portalLabel: 'HR Portal',
    sections: [
      {
        id: 'employment', title: 'Employment Details', description: 'Your role within the organization',
        fields: [
          { name: 'employeeId', label: 'Employee ID', type: 'text', required: true, placeholder: 'EMP-00123' },
          {
            name: 'department', label: 'Department', type: 'select', required: true,
            options: [
              { label: 'Human Resources', value: 'hr' },
              { label: 'Talent Acquisition', value: 'talent_acquisition' },
              { label: 'Payroll', value: 'payroll' },
              { label: 'Operations', value: 'operations' },
            ],
          },
          { name: 'designation', label: 'Designation', type: 'text', required: true, placeholder: 'HR Manager' },
          { name: 'yearsOfExperience', label: 'Years of Experience', type: 'number', required: true, validation: { min: 0, max: 60 } },
          { name: 'linkedinUrl', label: 'LinkedIn URL', type: 'url', required: false, placeholder: 'https://linkedin.com/in/yourname' },
        ],
      },
      {
        id: 'contact', title: 'Contact Information',
        fields: [
          { name: 'officePhone', label: 'Office Phone', type: 'tel', required: true, placeholder: '+91 22 1234 5678' },
          { name: 'mobileNumber', label: 'Mobile Number', type: 'tel', required: true, placeholder: '+91 98765 43210' },
          { name: 'emergencyContact', label: 'Emergency Contact', type: 'tel', required: true, placeholder: '+91 90000 00000' },
        ],
      },
      {
        id: 'location', title: 'Location',
        fields: [
          { name: 'country', label: 'Country', type: 'select', required: true, options: COUNTRY_OPTIONS },
          { name: 'state', label: 'State', type: 'text', required: true },
          { name: 'city', label: 'City', type: 'text', required: true },
          { name: 'officeLocation', label: 'Office Location', type: 'text', required: true, placeholder: 'HQ - Tower B, 4th Floor' },
        ],
      },
      COMMON_SECTION,
    ],
  },
  institutional: {
    portal: 'institutional',
    portalLabel: 'Institutional Admin Portal',
    sections: [
      {
        id: 'institution', title: 'Institution Details',
        fields: [
          { name: 'institutionName', label: 'Institution Name', type: 'text', required: true },
          { name: 'institutionCode', label: 'Institution Code', type: 'text', required: true, placeholder: 'INST-4521' },
          { name: 'adminId', label: 'Admin ID', type: 'text', required: true },
          { name: 'designation', label: 'Designation', type: 'text', required: true, placeholder: 'Principal / Registrar' },
          { name: 'website', label: 'Website', type: 'url', required: false, placeholder: 'https://institution.edu' },
        ],
      },
      {
        id: 'contact', title: 'Contact Information',
        fields: [
          { name: 'officePhone', label: 'Office Phone', type: 'tel', required: true },
          { name: 'mobileNumber', label: 'Mobile Number', type: 'tel', required: true },
        ],
      },
      {
        id: 'location', title: 'Location',
        fields: [
          { name: 'country', label: 'Country', type: 'select', required: true, options: COUNTRY_OPTIONS },
          { name: 'state', label: 'State', type: 'text', required: true },
          { name: 'district', label: 'District', type: 'text', required: true },
          { name: 'city', label: 'City', type: 'text', required: true },
          { name: 'officeAddress', label: 'Office Address', type: 'textarea', required: true },
        ],
      },
      COMMON_SECTION,
    ],
  },
  faculty: {
    portal: 'faculty',
    portalLabel: 'Faculty Portal',
    sections: [
      {
        id: 'employment', title: 'Employment Details',
        fields: [
          { name: 'facultyId', label: 'Faculty ID', type: 'text', required: true },
          { name: 'department', label: 'Department', type: 'text', required: true },
          { name: 'designation', label: 'Designation', type: 'text', required: true, placeholder: 'Assistant Professor' },
          { name: 'qualification', label: 'Qualification', type: 'text', required: true, placeholder: 'Ph.D. in Computer Science' },
          { name: 'experience', label: 'Experience', type: 'number', required: true, validation: { min: 0, max: 60 } },
          { name: 'subjectsHandling', label: 'Subjects Handling', type: 'textarea', required: true, placeholder: 'Data Structures, Algorithms' },
          { name: 'officeRoomNumber', label: 'Office Room Number', type: 'text', required: false, placeholder: 'B-204' },
        ],
      },
      {
        id: 'contact', title: 'Contact Information',
        fields: [
          { name: 'mobileNumber', label: 'Mobile Number', type: 'tel', required: true },
          { name: 'alternateNumber', label: 'Alternate Number', type: 'tel', required: false },
        ],
      },
      {
        id: 'location', title: 'Location',
        fields: [
          { name: 'country', label: 'Country', type: 'select', required: true, options: COUNTRY_OPTIONS },
          { name: 'state', label: 'State', type: 'text', required: true },
          { name: 'district', label: 'District', type: 'text', required: true },
          { name: 'city', label: 'City', type: 'text', required: true },
        ],
      },
      COMMON_SECTION,
    ],
  },
};

function portalForRole(role) {
  return ROLE_TO_PORTAL[role] || null;
}

module.exports = { SCHEMAS, portalForRole };
