import { CurrencyPipe, DatePipe, formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, LOCALE_ID, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, concat, EMPTY, exhaustMap, forkJoin, map, of, startWith, Subject, switchMap, takeUntil, tap, throwError, timer } from 'rxjs';
import { ParticipantCardComponent } from '@app/components/group-orders/participant-card/participant-card.component';
import { GroupReservationStatus } from '@app/models/group-orders/group-status.model';
import { Participant } from '@app/models/group-orders/participant.model';
import { NOTE_MAX_LENGTH, QUICK_NOTE_TAGS, SubmitExtras } from '@app/models/group-orders/submit-group-pre-order.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { ToastService } from '@app/services/toast/toast.service';
import { ModalComponent } from '@app/shared/custom-components/modal/modal.component';
import { consolidatePreOrder } from '@app/shared/helpers/consolidate-pre-order';

const SYNC_MS = 15_000;

const STATUS_LABELS: Record<GroupReservationStatus, string> = {
  Open: 'Collecting pre-orders',
  Submitted: 'Sent to Restaurant',
  Closed: 'Closed',
};

@Component({
  selector: 'app-group-order-page',
  imports: [ParticipantCardComponent, ModalComponent, CurrencyPipe, DatePipe],
  templateUrl: './group-order-page.component.html',
  styleUrl: './group-order-page.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class GroupOrderPageComponent implements OnInit {
  private readonly groupOrdersService = inject(GroupOrdersService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);
  private readonly reservationId = inject(ActivatedRoute).snapshot.paramMap.get('reservationId') ?? '';

  readonly loadState = signal<'loading' | 'ready' | 'error' | 'not-found'>('loading');
  readonly invite = signal<GuestInvite | null>(null);
  readonly participants = signal<Participant[]>([]);
  readonly ownerSessionId = signal('');
  readonly status = signal<GroupReservationStatus>('Open');
  readonly confirmOpen = signal(false);
  readonly submitting = signal(false);
  readonly updatedAt = signal<Date | null>(null);
  readonly refreshFailed = signal(false);

  // Нотатка для ресторану. Живе в стані сторінки, тож не зникає, якщо закрити й знову відкрити діалог.
  readonly noteMax = NOTE_MAX_LENGTH;
  readonly quickTags = QUICK_NOTE_TAGS;
  readonly note = signal('');
  readonly serveAt = signal('');
  /** Що вже відправлено ресторану (з відповіді status або з успішного Submit). */
  readonly sentNote = signal('');
  readonly sentServeAt = signal('');

  private readonly manualRefresh$ = new Subject<void>();
  private readonly stopSync$ = new Subject<void>();
  private syncStarted = false;

  readonly consolidated = computed(() => consolidatePreOrder(this.participants()));
  readonly unsubmittedCount = computed(() => this.participants().filter((person) => !person.isSubmitted).length);
  readonly hasAnyDishes = computed(() => this.participants().some((person) => person.items.length > 0));
  readonly isOpen = computed(() => this.status() === 'Open');
  readonly statusLabel = computed(() => STATUS_LABELS[this.status()]);
  /** Межі для поля часу: від початку до кінця бронювання, у форматі HH:mm. */
  readonly serveAtRange = computed(() => {
    const info = this.invite();
    if (!info) {
      return null;
    }
    const min = formatDate(info.StartTime, 'HH:mm', this.locale);
    const max = formatDate(info.EndTime, 'HH:mm', this.locale);
    return min <= max ? { min, max } : null; // бронювання через північ — межі не перевіряємо
  });
  readonly serveAtError = computed(() => {
    const value = this.serveAt();
    const range = this.serveAtRange();
    if (!value || !range) {
      return '';
    }
    return value < range.min || value > range.max ? `Choose a time between ${range.min} and ${range.max}` : '';
  });
  readonly canConfirm = computed(() => this.note().length <= this.noteMax && !this.serveAtError());
  readonly hasSentNote = computed(() => !this.isOpen() && (!!this.sentNote() || !!this.sentServeAt()));
  readonly canSubmit = computed(
    () => this.isOpen() && this.consolidated().items.length > 0 && !this.submitting(),
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadState.set('loading');

    this.groupOrdersService
      .getGroupInvite$(this.reservationId)
      .pipe(
        // Після Submit (або коли група заповнена) гостьове запрошення віддає 400 — беремо дані через Owner-ендпоінт.
        catchError((error: unknown) =>
          error instanceof HttpErrorResponse && error.status === 400
            ? this.groupOrdersService.getOwnerGroupInvite$(this.reservationId)
            : throwError(() => error),
        ),
        switchMap((invite) =>
          forkJoin({
            sessions: this.groupOrdersService.getSessions$(invite.GroupReservationId),
            ownerSessionId: this.groupOrdersService.getOwnerSessionId$(this.reservationId),
            status: this.groupOrdersService.getStatus$(invite.GroupReservationId),
          }).pipe(map((data) => ({ invite, ...data }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ invite, sessions, ownerSessionId, status }) => {
          this.invite.set(invite);
          this.participants.set(sessions.participants);
          this.ownerSessionId.set(ownerSessionId);
          this.status.set(status.status);
          this.sentNote.set(status.note ?? '');
          this.sentServeAt.set(status.serveAt ?? '');
          this.loadState.set('ready');
          this.updatedAt.set(new Date());
          this.refreshFailed.set(false);
          if (status.status === 'Open') {
            this.startSync(invite.GroupReservationId);
          }
        },
        error: (error: unknown) => {
          this.loadState.set(error instanceof HttpErrorResponse && error.status === 404 ? 'not-found' : 'error');
        },
      });
  }

  /** Кнопка Refresh: оновити зараз і скинути 15-секундний відлік. */
  refresh(): void {
    this.manualRefresh$.next();
  }

  /** Стартує один раз, після першого успішного завантаження. */
  private startSync(groupId: string): void {
    if (this.syncStarted) {
      return;
    }
    this.syncStarted = true;

    this.manualRefresh$
      .pipe(
        map(() => true),
        startWith(false),
        // switchMap скидає таймер; після ручного Refresh перший запит іде одразу (синхронно).
        switchMap((manual) => (manual ? concat(of(0), timer(SYNC_MS, SYNC_MS)) : timer(SYNC_MS, SYNC_MS))),
        // exhaustMap: поки попередній запит не завершився, нові тики ігноруються.
        exhaustMap(() =>
          this.groupOrdersService.getSessions$(groupId, { silent: true }).pipe(
            tap((response) => {
              // Відповідь, що прийшла посеред Submit або після нього, ігноруємо.
              if (this.submitting() || !this.isOpen()) {
                return;
              }
              this.participants.set(response.participants);
              this.updatedAt.set(new Date());
              this.refreshFailed.set(false);
            }),
            catchError(() => {
              this.refreshFailed.set(true); // старі дані лишаються на екрані
              return EMPTY;
            }),
          ),
        ),
        takeUntil(this.stopSync$),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  onNoteInput(event: Event): void {
    this.note.set((event.target as HTMLTextAreaElement).value.slice(0, this.noteMax));
  }

  onServeAtInput(event: Event): void {
    this.serveAt.set((event.target as HTMLInputElement).value);
  }

  /** Швидкий тег: додає фразу до нотатки, якщо вона ще не там і вміщається в ліміт. */
  addTag(text: string): void {
    const current = this.note().trimEnd();
    if (current.includes(text.trim())) {
      return;
    }
    const next = current ? `${current}. ${text}` : text;
    if (next.length <= this.noteMax) {
      this.note.set(next);
    }
  }

  openConfirm(): void {
    if (this.canSubmit()) {
      this.confirmOpen.set(true);
    }
  }

  closeConfirm(): void {
    if (!this.submitting()) {
      this.confirmOpen.set(false);
    }
  }

  confirmSubmit(): void {
    const invite = this.invite();
    if (!invite || this.submitting()) {
      return;
    }
    if (!this.canConfirm()) {
      return;
    }
    this.submitting.set(true);

    const extras: SubmitExtras = {};
    const note = this.note().trim();
    if (note) {
      extras.note = note;
    }
    if (this.serveAt()) {
      extras.serveAt = this.serveAt();
    }
    // Без нотатки і часу викликаємо рівно як раніше: submit$(групa, бронювання).
    const request$ = Object.keys(extras).length
      ? this.groupOrdersService.submit$(invite.GroupReservationId, this.reservationId, extras)
      : this.groupOrdersService.submit$(invite.GroupReservationId, this.reservationId);

    // Помилку toast-ом уже показує tokenInterceptor — тут лише повертаємо екран у робочий стан.
    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.status.set('Submitted');
          this.sentNote.set(note);
          this.sentServeAt.set(this.serveAt());
          this.note.set('');
          this.serveAt.set('');
          this.stopSync$.next();
          this.refreshFailed.set(false);
          this.submitting.set(false);
          this.confirmOpen.set(false);
          this.toastService.success('Pre-order sent to the restaurant');
        },
        error: () => {
          this.submitting.set(false);
          this.confirmOpen.set(false);
        },
      });
  }
}
