export type GroupReservationStatus = 'Open' | 'Submitted' | 'Closed';

/** GET /guest/groups/{groupReservationId}/status */
export interface GroupStatusResponse {
  currentParticipants: number;
  maxCapacity: number;
  status: GroupReservationStatus;
  /** Нотатка Owner для ресторану (є після Submit, якщо її вказали). */
  note?: string | null;
  /** Бажаний час подачі HH:mm (є після Submit, якщо його вказали). */
  serveAt?: string | null;
}
