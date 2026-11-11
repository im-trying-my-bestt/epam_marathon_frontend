import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, switchMap } from 'rxjs';
import { SKIP_ERROR_TOAST } from '@app/auth/skip-error-toast.context';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GroupStatusResponse } from '@app/models/group-orders/group-status.model';
import { OwnerSessionResponse } from '@app/models/group-orders/owner-session.model';
import { SubmitExtras, SubmitGroupPreOrderRequest, SubmittedDish } from '@app/models/group-orders/submit-group-pre-order.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';

export interface RequestOptions {
  /** true → фоновий запит: помилка не показує toast (SKIP_ERROR_TOAST). */
  silent?: boolean;
}

@Injectable({ providedIn: 'root' })
export class GroupOrdersService {
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly http = inject(HttpClient);
  private readonly guestInviteService = inject(GuestInviteService);

  /** reservationId → invite-token → invite (з GroupReservationId і даними для шапки). */
  getGroupInvite$(reservationId: string): Observable<GuestInvite> {
    return this.guestInviteService
      .getInviteToken$(reservationId)
      .pipe(switchMap((response) => this.guestInviteService.getInvite$(response.token)));
  }
  /**
 * Запасний шлях для Owner, коли гостьове запрошення недоступне (група Submitted або заповнена).
 * Дані шапки приходять з owner-ендпоінта, який перевіряє власника бронювання і не залежить від статусу групи.
 */
  getOwnerGroupInvite$(reservationId: string): Observable<GuestInvite> {
    return this.http
      .get<OwnerSessionResponse>(`${this.baseUrl}/reservations/${encodeURIComponent(reservationId)}/guest-session-id`)
      .pipe(
        map((owner) => ({
          GroupReservationId: owner.groupReservationId ?? '',
          LocationId: '',
          RestaurantName: 'Green & Tasty',
          LocationAddress: owner.locationAddress ?? '',
          StartTime: owner.startTime ?? '',
          EndTime: owner.endTime ?? '',
          MaxGuestCount: owner.maxGuestCount ?? 0,
          TableNumber: 0,
          InviterName: '',
        })),
      );
  }

  getSessions$(groupReservationId: string, options?: RequestOptions): Observable<GroupSessionsResponse> {
    return this.http.get<GroupSessionsResponse>(
      `${this.baseUrl}/guest/groups/${encodeURIComponent(groupReservationId)}/sessions`,
      { context: this.contextFor(options) },
    );
  }

  getOwnerSessionId$(reservationId: string): Observable<string> {
    return this.http
      .get<OwnerSessionResponse>(`${this.baseUrl}/reservations/${encodeURIComponent(reservationId)}/guest-session-id`)
      .pipe(map((response) => response.guestSessionId));
  }

  getStatus$(groupReservationId: string, options?: RequestOptions): Observable<GroupStatusResponse> {
    return this.http.get<GroupStatusResponse>(
      `${this.baseUrl}/guest/groups/${encodeURIComponent(groupReservationId)}/status`,
      { context: this.contextFor(options) },
    );
  }

  submit$(groupReservationId: string, reservationId: string, extras?: SubmitExtras): Observable<SubmittedDish[]> {
    const body: SubmitGroupPreOrderRequest = { reservationId };
    const note = extras?.note?.trim();
    if (note) {
      body.note = note;
    }
    if (extras?.serveAt) {
      body.serveAt = extras.serveAt;
    }
    return this.http.post<SubmittedDish[]>(
      `${this.baseUrl}/group-reservations/${encodeURIComponent(groupReservationId)}/submit`,
      body,
    );
  }

  private contextFor(options?: RequestOptions): HttpContext {
    return new HttpContext().set(SKIP_ERROR_TOAST, !!options?.silent);
  }
}
