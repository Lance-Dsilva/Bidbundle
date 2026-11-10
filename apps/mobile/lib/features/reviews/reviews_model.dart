import 'package:flutter/foundation.dart';

import '../../core/api.dart';
import 'models.dart';

enum ReviewsStatus { idle, loading, ready, failed }

class ReviewsModel extends ChangeNotifier {
  ReviewsModel(this.repository, {required this.onSessionExpired});
  final ReviewsRepository repository;
  final VoidCallback onSessionExpired;
  String? _owner;
  int _generation = 0;
  bool _disposed = false;
  ReviewsStatus status = ReviewsStatus.idle;
  ReviewsPage? page;
  String? message;
  void close() {
    final owner = _owner;
    clear();
    _owner = owner;
  }

  void _emit() {
    if (!_disposed) notifyListeners();
  }

  void setOwner(String? id) {
    if (_owner == id) return;
    clear();
    if (id != null && id.isNotEmpty) _owner = id;
  }

  void clear() {
    _owner = null;
    _generation++;
    page = null;
    message = null;
    status = ReviewsStatus.idle;
    _emit();
  }

  bool _current(String owner, int generation) =>
      !_disposed && _owner == owner && generation == _generation;
  Future<void> load() async {
    final owner = _owner;
    if (_disposed || owner == null || status == ReviewsStatus.loading) {
      return;
    }
    final generation = ++_generation;
    page = null;
    message = null;
    status = ReviewsStatus.loading;
    _emit();
    try {
      final loaded = await repository.load();
      if (!_current(owner, generation)) return;
      page = loaded;
      status = ReviewsStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, generation)) return;
      if (error is ApiFailure && error.kind == FailureKind.unauthenticated) {
        clear();
        onSessionExpired();
        return;
      }
      status = ReviewsStatus.failed;
      message = 'We could not load published reviews. Please try again.';
      _emit();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
