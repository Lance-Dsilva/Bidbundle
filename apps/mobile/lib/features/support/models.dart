import '../../core/api.dart';
import '../../core/json_fields.dart';
import '../home/models.dart';

String _text(Map<String, dynamic> json, String key) {
  final value = field<String>(json, key);
  if (value.trim().isEmpty) throw const ApiFailure(FailureKind.invalidResponse);
  return value;
}

/// Only customer presentation fields, not requester/admin identity or counts.
class SupportTicketSummary {
  SupportTicketSummary.fromJson(Map<String, dynamic> json)
    : id = _text(json, 'id'),
      ticketNumber = _text(json, 'ticketNumber'),
      subject = _text(json, 'subject'),
      category = _text(json, 'category'),
      status = _text(json, 'status'),
      communityName = nullableWireText(json, 'communityName'),
      createdAt = wireDate(json, 'createdAt', nullable: false)!,
      lastActivityAt = wireDate(json, 'lastActivityAt', nullable: false)!;
  final String id, ticketNumber, subject, category, status;
  final String? communityName;
  final DateTime createdAt, lastActivityAt;
}

class SupportMessage {
  SupportMessage.fromJson(Map<String, dynamic> json)
    : id = _text(json, 'id'),
      kind = _text(json, 'kind'),
      body = field<String>(json, 'body'),
      authorSide = _text(json, 'authorSide'),
      createdAt = wireDate(json, 'createdAt', nullable: false)! {
    if (!{'customer_reply', 'admin_reply'}.contains(kind) ||
        !{'you', 'support', 'customer'}.contains(authorSide) ||
        field<bool>(json, 'fromAi')) {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
  }
  final String id, kind, body, authorSide;
  final DateTime createdAt;
}

class SupportTicketDetail extends SupportTicketSummary {
  SupportTicketDetail.fromJson(Map<String, dynamic> json)
    : super.fromJson(json) {
    messages = List.unmodifiable(
      field<List<dynamic>>(json, 'messages').map((row) {
        if (row is! Map<String, dynamic>) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return SupportMessage.fromJson(row);
      }),
    );
  }
  late final List<SupportMessage> messages;
}

class SupportRepository {
  SupportRepository(this.api);
  final ApiClient api;
  Future<List<SupportTicketSummary>> loadList() async {
    final envelope = await api.get('/api/support/tickets');
    return List.unmodifiable(
      field<List<dynamic>>(envelope, 'tickets').map((row) {
        if (row is! Map<String, dynamic>) {
          throw const ApiFailure(FailureKind.invalidResponse);
        }
        return SupportTicketSummary.fromJson(row);
      }),
    );
  }

  Future<SupportTicketDetail> loadDetail(String id) async {
    if (id.trim().isEmpty || id == '.' || id == '..') {
      throw const ApiFailure(FailureKind.invalidResponse);
    }
    final envelope = await api.get(
      '/api/support/tickets/${Uri.encodeComponent(id)}',
    );
    final detail = SupportTicketDetail.fromJson(
      field<Map<String, dynamic>>(envelope, 'ticket'),
    );
    if (detail.id != id) throw const ApiFailure(FailureKind.invalidResponse);
    return detail;
  }
}
