import { Component, computed, inject, OnInit, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/services/auth.service';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService, WbsCodeView } from '../../core/services/api.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { Domain, User } from '../../core/models/models';

type Tab = 'DOMAINS' | 'WBS' | 'USERS';

@Component({
  selector: 'dtt-admin-panel',
  imports: [FormsModule, MatIconModule, PageHeaderComponent],
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

  constructor() {
    if (this.auth.isSuperAdmin()) this.tab.set('DOMAINS');
    effect(() => { this.ctx.selectedId(); this.load(); });
  }
  ngOnInit(): void { this.load(); }

  private load(): void {
    const domainId = this.ctx.selectedId() ?? undefined;
    this.api.getDomains().subscribe((d) => this.domains.set(d));
    this.api.getWbs(domainId).subscribe((w) => this.wbs.set(w));
    this.api.getUsers(domainId).subscribe((u) => this.users.set(u));
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
    const name = prompt('Domain name', d.name); if (name === null) return;
    const description = prompt('Description', d.description) ?? d.description;
    this.api.updateDomain(d.id, { name, description }).subscribe(() => { this.load(); this.ctx.load(); });
  }
  deleteDomain(d: Domain): void {
    if (!confirm(`Delete domain ${d.name}? This cannot be undone.`)) return;
    this.api.deleteDomain(d.id).subscribe(() => { this.load(); this.ctx.load(); });
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
    const description = prompt(`Rename ${w.code} (creates a new effective-dated name; history preserved)`, w.currentName);
    if (!description || description === w.currentName) return;
    this.api.updateWbs(w.id, { description }).subscribe(() => this.load());
  }
  deleteWbs(w: WbsCodeView): void {
    if (!confirm(`Delete ${w.code}?`)) return;
    this.api.deleteWbs(w.id).subscribe(() => this.load());
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
  grant(u: User): void {
    // Super Admin allocates which domains this admin manages.
    const options = this.domains().map((d) => `${d.name} (${d.id})`).join(', ');
    const input = prompt(`Grant admin to ${u.name}. Enter domain names to allocate (comma-separated).\nAvailable: ${this.domains().map(d => d.name).join(', ')}`, this.domains().map(d => d.name).join(', '));
    if (input === null) return;
    const names = input.split(',').map((s) => s.trim().toLowerCase());
    const domainIds = this.domains().filter((d) => names.includes(d.name.toLowerCase())).map((d) => d.id);
    this.api.grantAdmin(u.id, domainIds.length ? domainIds : undefined).subscribe(() => this.load());
  }
  revoke(u: User): void {
    if (!confirm(`Revoke admin from ${u.name}?`)) return;
    this.api.revokeAdmin(u.id).subscribe(() => this.load());
  }
  roleChip(u: User): string {
    return u.role === 'SUPER_ADMIN' ? 'Super Admin' : u.role === 'DOMAIN_ADMIN' ? 'Admin' : 'Employee';
  }
  isMe(u: User): boolean { return u.id === this.auth.user()?.id; }
}
