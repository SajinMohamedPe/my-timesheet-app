import { Component, computed, inject, OnInit, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/services/auth.service';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService, WbsCodeView } from '../../core/services/api.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { Domain, User } from '../../core/models/models';

type Tab = 'DOMAINS' | 'WBS' | 'USERS';

@Component({
  selector: 'dtt-admin-panel',
  imports: [FormsModule, MatIconModule, PageHeaderComponent, ConfirmDialogComponent],
  templateUrl: './admin-panel.component.html',
  styleUrl: './admin-panel.component.scss',
})
export class AdminPanelComponent implements OnInit {
  auth = inject(AuthService);
  ctx = inject(DomainContextService);
  private api = inject(ApiService);

  tab = signal<Tab>('WBS');
  domains = signal<Domain[]>([]);
  wbs = signal<WbsCodeView[]>([]);
  users = signal<User[]>([]);

  // add-forms
  addingDomain = signal(false);
  newDomain = { name: '', description: '' };
  addingWbs = signal(false);
  newWbs = { code: '', clientCode: '', description: '' };
  addingUser = signal(false);
  newUser = { name: '', username: '', email: '', type: 'CONTRACTOR' as 'CONTRACTOR' | 'STAFF' };

  // Super-admin domain allocation modal
  allocUser = signal<User | null>(null);
  allocSel = signal<Record<string, boolean>>({});
  // Revoke-admin confirmation modal
  revokeUser = signal<User | null>(null);
  // Edit-domain modal
  editingDomain = signal<Domain | null>(null);
  editDomainForm = { name: '', description: '' };
  // Rename-WBS modal
  renamingWbs = signal<WbsCodeView | null>(null);
  renameWbsValue = '';
  // Delete confirmations
  deleteDomainTarget = signal<Domain | null>(null);
  deleteWbsTarget = signal<WbsCodeView | null>(null);

  constructor() {
    if (this.auth.isSuperAdmin()) this.tab.set('DOMAINS');
    effect(() => { this.ctx.selectedId(); this.load(); });
  }
  ngOnInit(): void { this.load(); }

  private load(): void {
    const domainId = this.ctx.selectedId() ?? undefined;
    this.api.getDomains().subscribe((d) => this.domains.set(d));
    this.api.getWbs(domainId).subscribe((w) => this.wbs.set(w));
    // A Super Admin manages users/allocations across ALL domains, so don't scope
    // the user list to the active domain — otherwise an admin from another domain
    // couldn't be found to (re)allocate. Domain Admins stay scoped.
    const userScope = this.auth.isSuperAdmin() ? undefined : domainId;
    this.api.getUsers(userScope).subscribe((u) => this.users.set(u));
  }

  domainName(id: string): string { return this.domains().find((d) => d.id === id)?.name ?? id; }

  // ---- Domains (Super Admin) ----
  saveDomain(): void {
    if (!this.newDomain.name.trim()) return;
    this.api.createDomain({ ...this.newDomain }).subscribe(() => {
      this.newDomain = { name: '', description: '' }; this.addingDomain.set(false); this.load(); this.ctx.load();
    });
  }
  editDomain(d: Domain): void {
    this.editDomainForm = { name: d.name, description: d.description };
    this.editingDomain.set(d);
  }
  saveEditDomain(): void {
    const d = this.editingDomain(); if (!d || !this.editDomainForm.name.trim()) return;
    this.api.updateDomain(d.id, { name: this.editDomainForm.name.trim(), description: this.editDomainForm.description })
      .subscribe(() => { this.editingDomain.set(null); this.load(); this.ctx.load(); });
  }
  deleteDomain(d: Domain): void { this.deleteDomainTarget.set(d); }
  confirmDeleteDomain(): void {
    const d = this.deleteDomainTarget(); if (!d) return;
    this.api.deleteDomain(d.id).subscribe(() => { this.deleteDomainTarget.set(null); this.load(); this.ctx.load(); });
  }

  // ---- WBS codes ----
  saveWbs(): void {
    const domainId = this.ctx.selectedId();
    if (!domainId || !this.newWbs.code.trim() || !this.newWbs.description.trim()) return;
    this.api.createWbs({ domainId, ...this.newWbs }).subscribe(() => {
      this.newWbs = { code: '', clientCode: '', description: '' }; this.addingWbs.set(false); this.load();
    });
  }
  renameWbs(w: WbsCodeView): void {
    this.renameWbsValue = w.currentName;
    this.renamingWbs.set(w);
  }
  saveRenameWbs(): void {
    const w = this.renamingWbs(); if (!w) return;
    const description = this.renameWbsValue.trim();
    if (!description || description === w.currentName) { this.renamingWbs.set(null); return; }
    this.api.updateWbs(w.id, { description }).subscribe(() => { this.renamingWbs.set(null); this.load(); });
  }
  deleteWbs(w: WbsCodeView): void { this.deleteWbsTarget.set(w); }
  confirmDeleteWbs(): void {
    const w = this.deleteWbsTarget(); if (!w) return;
    this.api.deleteWbs(w.id).subscribe(() => { this.deleteWbsTarget.set(null); this.load(); });
  }

  // ---- Users & roles ----
  saveUser(): void {
    const domainId = this.ctx.selectedId();
    if (!domainId || !this.newUser.name.trim() || !this.newUser.username.trim()) return;
    this.api.createUser({
      name: this.newUser.name, username: this.newUser.username.toLowerCase(),
      email: this.newUser.email, type: this.newUser.type, domainIds: [domainId],
    }).subscribe(() => {
      this.newUser = { name: '', username: '', email: '', type: 'CONTRACTOR' }; this.addingUser.set(false); this.load();
    });
  }
  // Super Admin allocates which domain(s) an admin manages (many-to-many).
  // Opens for an employee (to grant + allocate) or an existing admin (to re-allocate).
  openAllocate(u: User): void {
    const sel: Record<string, boolean> = {};
    for (const d of this.domains()) sel[d.id] = u.domainIds.includes(d.id);
    this.allocSel.set(sel);
    this.allocUser.set(u);
  }
  toggleAlloc(id: string): void {
    this.allocSel.update((s) => ({ ...s, [id]: !s[id] }));
  }
  allocCount(): number { return Object.values(this.allocSel()).filter(Boolean).length; }
  saveAllocate(): void {
    const u = this.allocUser(); if (!u) return;
    const domainIds = this.domains().map((d) => d.id).filter((id) => this.allocSel()[id]);
    if (!domainIds.length) return; // an admin must manage at least one domain
    this.api.grantAdmin(u.id, domainIds).subscribe(() => { this.allocUser.set(null); this.load(); });
  }
  revoke(u: User): void { this.revokeUser.set(u); }
  confirmRevoke(): void {
    const u = this.revokeUser(); if (!u) return;
    this.api.revokeAdmin(u.id).subscribe(() => { this.revokeUser.set(null); this.load(); });
  }
  roleChip(u: User): string {
    return u.role === 'SUPER_ADMIN' ? 'Super Admin' : u.role === 'DOMAIN_ADMIN' ? 'Admin' : 'Employee';
  }
  isMe(u: User): boolean { return u.id === this.auth.user()?.id; }
}
