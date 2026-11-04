import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { Participant } from '@app/models/group-orders/participant.model';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GroupStatusResponse } from '@app/models/group-orders/group-status.model';

import {
  DEMO_RESERVATION_ID,
  GroupOrdersMockStore,
  MockHttpError,
} from '@app/shared/mocks/group-orders/group-orders.mock-store';

@Component({
  standalone: true,
  selector: 'app-group-order-demo-page',
  templateUrl: './group-order-demo-page.component.html',
  styleUrl: './group-order-demo-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupOrderDemoPageComponent {
  private readonly store = new GroupOrdersMockStore();

  readonly sessions = signal<GroupSessionsResponse>(this.store.snapshot());
  readonly status = signal<GroupStatusResponse>(this.store.groupStatus());
  readonly submittedDishes = signal<{ dishId: string; quantity: number }[]>([]);
  readonly message = signal('');
  readonly errorMessage = signal('');

  get participants(): Participant[] {
    return this.sessions().participants;
  }

  removeGuest(guestSessionId: string): void {
    this.message.set('');
    this.errorMessage.set('');

    try {
      this.sessions.set(this.store.remove(guestSessionId));
      this.status.set(this.store.groupStatus());
      this.message.set('Guest was removed from the group order.');
    } catch (error) {
      this.handleError(error);
    }
  }

  submitGroupOrder(): void {
    this.message.set('');
    this.errorMessage.set('');

    try {
      const result = this.store.submit(DEMO_RESERVATION_ID);

      this.submittedDishes.set(result);
      this.sessions.set(this.store.snapshot());
      this.status.set(this.store.groupStatus());

      this.message.set('Group order was successfully submitted!');
    } catch (error) {
      this.handleError(error);
    }
  }

  resetDemo(): void {
    this.store.reset();

    this.sessions.set(this.store.snapshot());
    this.status.set(this.store.groupStatus());
    this.submittedDishes.set([]);
    this.message.set('Demo data has been reset.');
    this.errorMessage.set('');
  }

  private handleError(error: unknown): void {
    if (error instanceof MockHttpError) {
      this.errorMessage.set(error.message);
      return;
    }

    this.errorMessage.set('An unexpected error occurred.');
  }
}
