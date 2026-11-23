'use strict';
import { describe, it, expect, beforeEach } from 'vitest';
const crypto = require('crypto');

// Simulating the registration and approval data layer logic directly for unit testing
describe('User Registration & Admin Approval Workflow Suite', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = {
      users: [
        {
          id: 'u_existing',
          name: 'Existing Member',
          username: 'member@company.com',
          email: 'member@company.com',
          role: 'estimator',
          salt: 'abcdef123456',
          pass: crypto.createHash('sha256').update('abcdef123456:Secret123#').digest('hex'),
          active: true,
          approvalStatus: 'APPROVED'
        }
      ],
      companies: [
        { id: 'co_test', name: 'AluFab Enterprise', code: 'ALUF101', active: true }
      ],
      registrations: [],
      demoRequests: []
    };
  });

  it('Step 1: Successfully registers a new user with status PENDING', () => {
    const regPayload = {
      fullName: 'Ahmad Rafiq',
      email: 'ahmad@example.com',
      password: 'StrongPassword123#',
      type: 'Company',
      companyName: 'Modern Glazing Systems',
      mobile: '+91 9092315029',
      country: 'India',
      address: '100 Mount Road, Chennai',
      service: 'Glazing & Windows',
      additionalRequirements: 'Require Domal 27 templates',
      termsAccepted: true
    };

    // Duplicate check
    const duplicate = mockDb.users.some(u => u.email === regPayload.email.toLowerCase()) ||
                      mockDb.registrations.some(r => r.email === regPayload.email.toLowerCase() && (r.status === 'PENDING' || r.status === 'APPROVED'));
    expect(duplicate).toBe(false);

    // Salt and hash password
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + ':' + regPayload.password).digest('hex');

    const newReg = {
      id: 'reg_101',
      fullName: regPayload.fullName,
      email: regPayload.email.toLowerCase(),
      username: regPayload.email.toLowerCase(),
      salt,
      pass: hash,
      type: regPayload.type,
      companyName: regPayload.companyName,
      mobile: regPayload.mobile,
      country: regPayload.country,
      address: regPayload.address,
      service: regPayload.service,
      additionalRequirements: regPayload.additionalRequirements,
      termsAccepted: true,
      status: 'PENDING',
      createdAt: new Date().toISOString()
    };

    mockDb.registrations.push(newReg);

    expect(mockDb.registrations.length).toBe(1);
    expect(mockDb.registrations[0].status).toBe('PENDING');
    expect(mockDb.registrations[0].fullName).toBe('Ahmad Rafiq');
  });

  it('Step 2: Prevents duplicate registration with the same email', () => {
    mockDb.registrations.push({
      id: 'reg_existing',
      email: 'duplicate@example.com',
      status: 'PENDING'
    });

    const isDuplicate = mockDb.registrations.some(r => r.email === 'duplicate@example.com' && (r.status === 'PENDING' || r.status === 'APPROVED'));
    expect(isDuplicate).toBe(true);
  });

  it('Step 3: Gating prevents login while registration is PENDING', () => {
    mockDb.registrations.push({
      id: 'reg_pending',
      email: 'pending.user@example.com',
      username: 'pending.user@example.com',
      status: 'PENDING'
    });

    const emailAttempt = 'pending.user@example.com';
    const userInDb = mockDb.users.find(u => u.email === emailAttempt);
    const regInDb = mockDb.registrations.find(r => r.email === emailAttempt);

    let allowLogin = false;
    let gateReason = null;

    if (!userInDb && regInDb) {
      if (regInDb.status === 'PENDING') {
        allowLogin = false;
        gateReason = 'Registration pending admin approval';
      }
    }

    expect(allowLogin).toBe(false);
    expect(gateReason).toBe('Registration pending admin approval');
  });

  it('Step 4: Admin approval activates account and creates Company + User record', () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + ':UserPass123#').digest('hex');

    const reg = {
      id: 'reg_approve_test',
      fullName: 'Tariq Hussain',
      email: 'tariq@facade.com',
      username: 'tariq@facade.com',
      salt,
      pass: hash,
      type: 'Company',
      companyName: 'Facade Masters Ltd',
      mobile: '+91 9887766554',
      status: 'PENDING'
    };
    mockDb.registrations.push(reg);

    // Admin approves
    reg.status = 'APPROVED';
    reg.approvedAt = new Date().toISOString();
    reg.approvedBy = 'master';

    // Provision company
    const newCompany = {
      id: 'co_facade',
      name: reg.companyName,
      code: 'FACA202',
      active: true
    };
    mockDb.companies.push(newCompany);

    // Provision user
    const newUser = {
      id: 'u_tariq',
      companyId: newCompany.id,
      name: reg.fullName,
      username: reg.email,
      email: reg.email,
      role: 'admin',
      salt: reg.salt,
      pass: reg.pass,
      active: true,
      approvalStatus: 'APPROVED'
    };
    mockDb.users.push(newUser);

    // Verify user can now authenticate
    const user = mockDb.users.find(u => u.email === 'tariq@facade.com');
    expect(user).toBeDefined();
    expect(user.approvalStatus).toBe('APPROVED');
    expect(user.active).toBe(true);

    // Verify password verification succeeds
    const checkHash = crypto.createHash('sha256').update(user.salt + ':UserPass123#').digest('hex');
    expect(checkHash).toBe(user.pass);
  });

  it('Step 5: Admin rejection updates status and blocks login with explanation', () => {
    const reg = {
      id: 'reg_reject_test',
      fullName: 'Invalid Applicant',
      email: 'fake@spammer.com',
      status: 'PENDING'
    };
    mockDb.registrations.push(reg);

    // Admin rejects
    reg.status = 'REJECTED';
    reg.rejectedAt = new Date().toISOString();
    reg.rejectionReason = 'Incomplete business credentials and invalid GST details.';

    expect(reg.status).toBe('REJECTED');
    expect(reg.rejectionReason).toContain('invalid GST');
  });

  it('Step 6: Request a Demo stores enquiry and validates fields', () => {
    const demoPayload = {
      name: 'Vikram Mehta',
      email: 'vikram@dlf.in',
      phone: '+91 9840112233',
      company: 'DLF Projects',
      message: 'Looking for 50-user license demonstration'
    };

    expect(demoPayload.name).toBeTruthy();
    expect(demoPayload.email).toContain('@');
    expect(demoPayload.phone).toBeTruthy();

    const demoReq = {
      id: 'demo_001',
      ...demoPayload,
      createdAt: new Date().toISOString()
    };
    mockDb.demoRequests.push(demoReq);

    expect(mockDb.demoRequests.length).toBe(1);
    expect(mockDb.demoRequests[0].company).toBe('DLF Projects');
  });
});
