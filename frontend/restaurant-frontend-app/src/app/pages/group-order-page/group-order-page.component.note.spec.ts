// Нотатка для ресторану + час подачі. Сервіс підмінено шпигуном.
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { ToastService } from '@app/services/toast/toast.service';
import { GroupStatusResponse } from '@app/models/group-orders/group-status.model';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { GroupOrderPageComponent } from './group-order-page.component';

const caesar = { id: 'dish1', name: 'Caesar Salad', price: 180 };
const SESSIONS: GroupSessionsResponse = {
  participants: [
    { id: 'owner', type: 'Owner', name: 'Yevhenii', isSubmitted: true, total: 180, items: [{ dish: caesar, quantity: 1 }] },
  ],
  total: 180,
};
const INVITE = {
  GroupReservationId: 'grp-1',
  LocationAddress: 'Rustaveli Avenue 48',
  MaxGuestCount: 5,
  StartTime: '2026-10-21T16:00:00Z',
  EndTime: '2026-10-21T17:30:00Z',
} as GuestInvite;

function buttonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
}

describe('Нотатка для ресторану', () => {
  let service: jasmine.SpyObj<GroupOrdersService>;

  function create(status: Record<string, unknown> = { status: 'Open' }) {
    service.getStatus$.and.returnValue(of({ currentParticipants: 1, maxCapacity: 5, ...status } as GroupStatusResponse));
    TestBed.configureTestingModule({
      imports: [GroupOrderPageComponent],
      providers: [
        { provide: GroupOrdersService, useValue: service },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ reservationId: 'res-1' }) } } },
      ],
    });
    const fixture = TestBed.createComponent(GroupOrderPageComponent);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement, component: fixture.componentInstance };
  }

  function openDialog(fixture: ReturnType<typeof create>['fixture'], element: HTMLElement): Element {
    buttonByText(element, 'Submit Pre-Order')?.click();
    fixture.detectChanges();
    return element.querySelector('[role="dialog"]')!;
  }

  beforeEach(() => {
    service = jasmine.createSpyObj<GroupOrdersService>('GroupOrdersService', [
      'getGroupInvite$', 'getSessions$', 'getOwnerSessionId$', 'getStatus$', 'submit$',
    ]);
    service.getGroupInvite$.and.returnValue(of(INVITE));
    service.getSessions$.and.returnValue(of(structuredClone(SESSIONS)));
    service.getOwnerSessionId$.and.returnValue(of('owner'));
    service.submit$.and.returnValue(of([{ dishId: 'dish1', quantity: 1 }]));
  });

  it('швидкий тег додає фразу в нотатку, а лічильник оновлюється', () => {
    const { fixture, element, component } = create();
    const dialog = openDialog(fixture, element);
    buttonByText(dialog, 'Birthday')?.click();
    fixture.detectChanges();
    expect(component.note()).toBe('Birthday celebration');
    expect(dialog.textContent).toContain('20 / 300');
  });

  it('той самий тег двічі не дублюється', () => {
    const { component } = create();
    component.addTag('Birthday celebration');
    component.addTag('Birthday celebration');
    expect(component.note()).toBe('Birthday celebration');
  });

  it('нотатка не перевищує 300 символів', () => {
    const { component } = create();
    component.onNoteInput({ target: { value: 'x'.repeat(400) } } as unknown as Event);
    expect(component.note().length).toBe(300);
  });

  it('нотатка лишається, якщо закрити й відкрити діалог', () => {
    const { fixture, element, component } = create();
    let dialog = openDialog(fixture, element);
    component.note.set('Nut allergy');
    buttonByText(dialog, 'Cancel')?.click();
    fixture.detectChanges();
    dialog = openDialog(fixture, element);
    expect((dialog.querySelector('#order-note') as HTMLTextAreaElement).value).toBe('Nut allergy');
  });

  it('Submit з нотаткою і часом передає їх у сервіс', () => {
    const { fixture, element, component } = create();
    const dialog = openDialog(fixture, element);
    component.note.set('  Nut allergy  ');
    component.serveAt.set('19:00');
    fixture.detectChanges();
    buttonByText(dialog, 'Submit')?.click();
    expect(service.submit$).toHaveBeenCalledOnceWith('grp-1', 'res-1', { note: 'Nut allergy', serveAt: '19:00' });
  });

  it('час поза межами бронювання блокує Submit і показує помилку', () => {
    const { fixture, element, component } = create();
    const dialog = openDialog(fixture, element);
    component.serveAt.set('03:00');
    fixture.detectChanges();
    expect(dialog.textContent).toContain('Choose a time between');
    expect(buttonByText(dialog, 'Submit')?.disabled).toBeTrue();
  });

  it('після Submit показує блок «Note sent to restaurant»', () => {
    const { fixture, element, component } = create();
    const dialog = openDialog(fixture, element);
    component.note.set('Nut allergy');
    fixture.detectChanges();
    buttonByText(dialog, 'Submit')?.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('Note sent to restaurant');
    expect(element.textContent).toContain('Nut allergy');
  });

  it('якщо група вже Submitted, нотатка береться з відповіді status', () => {
    const { element } = create({ status: 'Submitted', note: 'Table by the window', serveAt: '19:00' });
    expect(element.textContent).toContain('Table by the window');
    expect(element.textContent).toContain('19:00');
  });
});
