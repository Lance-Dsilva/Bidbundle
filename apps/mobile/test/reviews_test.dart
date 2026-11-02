// Synthetic published-review contract fixtures, not live moderation proof.
import 'dart:async';

import 'package:bundleen/core/api.dart';
import 'package:bundleen/features/reviews/models.dart';
import 'package:bundleen/features/reviews/reviews_model.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'mobile_test.dart' as base;
import 'requests_test.dart' as fixtures;
import 'support_test.dart' as support;
import 'provider_test.dart' as provider;

Map<String, Object?> review({String id = 'v1'}) => {
  'id': id,
  'reviewerName': 'Jordan Resident',
  'rating': 5,
  'comment': '<b>Helpful service</b>\nhttps://untrusted.example/path',
  'subjectLabel': null,
  'createdAt': '2026-11-01T15:00:00.000Z',
  'privateEmail': 'PRIVATE EMAIL',
  'address': 'PRIVATE ADDRESS',
  'verified': true,
};
Map<String, Object?> page({
  List<Map<String, Object?>>? rows,
  bool more = true,
}) => {
  'reviews': rows ?? [review()],
  'summary': {
    'averageRating': 3.5,
    'totalCount': 40,
    'distribution': [
      {'rating': 5, 'count': 2, 'percent': 99},
    ],
  },
  'page': {'limit': 20, 'offset': 0, 'total': 40, 'hasMore': more},
};
http.Response reviewsRoute(
  http.Request r, {
  String role = 'provider',
  Map<String, Object?>? data,
}) => r.url.path == '/api/provider/ratings'
    ? base.jsonResponse(data ?? page())
    : support.supportRoute(r, role: role);
ReviewsRepository repository(base.FakeAuth auth, http.Client client) =>
    ReviewsRepository(ApiClient(base.config(), auth, client));
void main() {
  test('nullable subject and plain text preserved', () {
    final v = PublishedReview.fromJson(review());
    expect(v.subjectLabel, isNull);
    expect(v.reviewerName, 'Jordan Resident');
    expect(v.comment, contains('<b>'));
  });
  for (final key in [
    'id',
    'reviewerName',
    'rating',
    'comment',
    'subjectLabel',
    'createdAt',
  ]) {
    test('required review$key missing fails', () {
      final data = review()..remove(key);
      expect(
        () => PublishedReview.fromJson(data),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  for (final rating in [0, 6, 4.5, '5']) {
    test('invalid rating$rating fails', () {
      expect(
        () => PublishedReview.fromJson({...review(), 'rating': rating}),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  test('canonical date required', () {
    expect(
      () => PublishedReview.fromJson({
        ...review(),
        'createdAt': '2026-02-31T15:00:00.000Z',
      }),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  for (final rating in [0, 5.1, double.nan, double.infinity]) {
    test('invalid average$rating fails', () {
      expect(
        () => ReviewsPage.fromJson({
          ...page(),
          'summary': {'averageRating': rating, 'totalCount': 40},
        }),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  test('summary is serverallpublished not pageaverage; races allowed', () {
    final v = ReviewsPage.fromJson({
      ...page(),
      'summary': {'averageRating': null, 'totalCount': 0},
      'page': {'limit': 20, 'offset': 0, 'total': 0, 'hasMore': false},
    });
    expect(v.reviews, hasLength(1));
    expect(v.averageRating, isNull);
    expect(v.totalCount, 0);
    final regular = ReviewsPage.fromJson(page());
    expect(regular.averageRating, 3.5);
    expect(regular.reviews.single.rating, 5);
  });
  for (final change in [
    {'limit': 50},
    {'offset': 1},
    {'hasMore': 'true'},
  ]) {
    test('wrong firstpage$change rejected', () {
      expect(
        () => ReviewsPage.fromJson({
          ...page(),
          'page': {'limit': 20, 'offset': 0, 'hasMore': true, ...change},
        }),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    });
  }
  test('duplicate and over20 reject without truncation', () {
    expect(
      () => ReviewsPage.fromJson(page(rows: [review(), review()])),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
    expect(
      () => ReviewsPage.fromJson(
        page(rows: List.generate(21, (i) => review(id: 'v$i'))),
      ),
      throwsA(base.failure(FailureKind.invalidResponse)),
    );
  });
  test('canonical GET20offset0 only without identityquery', () async {
    final calls = <http.Request>[];
    final repo = repository(
      base.FakeAuth()..active = true,
      MockClient((r) async {
        calls.add(r);
        return reviewsRoute(
          r,
          data: page(rows: List.generate(20, (i) => review(id: 'v$i'))),
        );
      }),
    );
    expect((await repo.load()).reviews, hasLength(20));
    expect(calls.single.method, 'GET');
    expect(calls.single.url.path, '/api/provider/ratings');
    expect(calls.single.url.queryParameters, {'limit': '20', 'offset': '0'});
  });
  for (final role in [
    'provider',
    'homeowner',
    'hoa_staff',
    'admin',
    'unknown',
  ]) {
    test('$role lazypublishedreviews gate', () async {
      final calls = <String>[];
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls.add(r.url.path);
          return reviewsRoute(r, role: role);
        }),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openAccount();
      expect(calls.where((p) => p == '/api/provider/ratings'), isEmpty);
      await vm.account.openReviews();
      expect(
        calls.where((p) => p == '/api/provider/ratings').length,
        role == 'provider' ? 1 : 0,
      );
      expect(calls.where((p) => p.contains('/ratings/')), isEmpty);
    });
  }
  for (final code in [403, 409, 500]) {
    test('review$code localerror preservesAccount and retries', () async {
      var failed = true;
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient(
          (r) async => r.url.path == '/api/provider/ratings' && failed
              ? http.Response('', code)
              : reviewsRoute(r),
        ),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openAccount();
      await vm.account.openReviews();
      expect(vm.reviews.status, ReviewsStatus.failed);
      expect(vm.account.profile, isNotNull);
      failed = false;
      await vm.reviews.load();
      expect(vm.reviews.status, ReviewsStatus.ready);
    });
  }
  test('refresh discards moderatedaway rows immediately', () async {
    var refresh = false;
    final response = Completer<http.Response>();
    final vm = ReviewsModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient((r) async => refresh ? response.future : reviewsRoute(r)),
      ),
      onSessionExpired: () {},
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    await vm.load();
    refresh = true;
    final pending = vm.load();
    expect(vm.page, isNull);
    response.complete(base.jsonResponse(page(rows: [], more: false)));
    await pending;
    expect(vm.page!.reviews, isEmpty);
  });
  for (final action in ['close', 'clear', 'owner']) {
    test('latereviews after$action discarded', () async {
      final response = Completer<http.Response>();
      final vm = ReviewsModel(
        repository(
          base.FakeAuth()..active = true,
          MockClient((r) => response.future),
        ),
        onSessionExpired: () {},
      );
      addTearDown(vm.dispose);
      vm.setOwner('u1');
      final pending = vm.load();
      if (action == 'close') {
        vm.close();
      } else if (action == 'clear') {
        vm.clear();
      } else {
        vm.setOwner('u2');
      }
      response.complete(base.jsonResponse(page()));
      await pending;
      expect(vm.page, isNull);
    });
  }
  test('oversize review fails preservingAccount', () async {
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient(
        (r) async => r.url.path == '/api/provider/ratings'
            ? base.jsonResponse(
                page(
                  rows: [
                    {...review(), 'comment': 'x' * (1024 * 1024)},
                  ],
                ),
              )
            : reviewsRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openAccount();
    await vm.account.openReviews();
    expect(vm.reviews.status, ReviewsStatus.failed);
    expect(vm.account.profile, isNotNull);
  });
  test('timeout fails without inventing emptyreviews', () async {
    final vm = ReviewsModel(
      ReviewsRepository(
        ApiClient(
          base.config(),
          base.FakeAuth()..active = true,
          MockClient((r) => Completer<http.Response>().future),
          timeout: const Duration(milliseconds: 10),
        ),
      ),
      onSessionExpired: () {},
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    await vm.load();
    expect(vm.status, ReviewsStatus.failed);
    expect(vm.page, isNull);
  });
  test('401failedrenewal clearsglobalreviews', () async {
    final vm = base.model(
      fixtures.FailedRefreshAuth()..active = true,
      MockClient(
        (r) async => r.url.path == '/api/provider/ratings'
            ? http.Response('', 401)
            : reviewsRoute(r),
      ),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openAccount();
    await vm.account.openReviews();
    expect(vm.signedIn, isFalse);
    expect(vm.reviews.page, isNull);
    expect(vm.account.profile, isNull);
  });
  testWidgets(
    '200percent actualreviewsbutton plaintext noverificationbadge and back',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final calls = <http.Request>[];
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async {
          calls.add(r);
          return reviewsRoute(r);
        }),
      );
      await fixtures.render(tester, vm);
      await fixtures.tapAndLoad(tester, find.text('Account'));
      await tester.scrollUntilVisible(find.text('Published reviews'), 400);
      await tester.pumpAndSettle();
      await fixtures.tapAndLoad(tester, find.text('Published reviews'));
      await tester.scrollUntilVisible(
        find.text('<b>Helpful service</b>\nhttps://untrusted.example/path'),
        400,
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.textContaining('PRIVATE'), findsNothing);
      expect(find.text('Verified'), findsNothing);
      expect(find.text('Anonymous'), findsNothing);
      final count = calls.length;
      await tester.tap(
        find.text('<b>Helpful service</b>\nhttps://untrusted.example/path'),
      );
      await tester.pumpAndSettle();
      expect(calls, hasLength(count));
      expect(calls.map((r) => r.method), everyElement('GET'));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(vm.account.showingReviews, isFalse);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
    },
  );
  testWidgets(
    'iOSreviewsback and rapidAccountchildren switch clearsreviewtext',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient((r) async => reviewsRoute(r)),
      );
      await fixtures.render(tester, vm);
      await fixtures.tapAndLoad(tester, find.text('Account'));
      await tester.runAsync(() => vm.account.openReviews());
      await tester.pumpAndSettle();
      await tester.dragFrom(const Offset(1, 300), const Offset(750, 0));
      await tester.pumpAndSettle();
      expect(vm.account.showingReviews, isFalse);
      await tester.runAsync(() => vm.account.openReviews());
      await tester.pump();
      await tester.runAsync(() => vm.account.openNotifications());
      await tester.pump();
      await tester.runAsync(() => vm.account.openReviews());
      await tester.pumpAndSettle();
      expect(vm.account.showingReviews, isTrue);
      expect(vm.account.showingNotifications, isFalse);
      await tester.runAsync(() => vm.signOut());
      await tester.pumpAndSettle();
      expect(vm.reviews.page, isNull);
      await tester.pumpWidget(const SizedBox());
      vm.dispose();
      debugDefaultTargetPlatformOverride = null;
    },
  );
  test('summary count must be safe nonnegative integer', () {
    for (final count in [-1, 0.5, '4', 9007199254740992]) {
      expect(
        () => ReviewsPage.fromJson({
          ...page(),
          'summary': {'averageRating': 3.5, 'totalCount': count},
        }),
        throwsA(base.failure(FailureKind.invalidResponse)),
      );
    }
  });
  for (final status in ['pending', 'suspended']) {
    test('$status provider can read publishedreviews', () async {
      final vm = base.model(
        base.FakeAuth()..active = true,
        MockClient(
          (r) async => r.url.path == '/api/provider/overview'
              ? base.jsonResponse({
                  'overview': provider.overview(status: status),
                })
              : reviewsRoute(r),
        ),
      );
      addTearDown(vm.dispose);
      await vm.initialize();
      await vm.openAccount();
      await vm.account.openReviews();
      expect(vm.reviews.status, ReviewsStatus.ready);
    });
  }
  test('late reviews after rolechange cannot restore old page', () async {
    var role = 'provider';
    final response = Completer<http.Response>();
    final started = Completer<void>();
    final vm = base.model(
      base.FakeAuth()..active = true,
      MockClient((r) async {
        if (r.url.path == '/api/provider/ratings') {
          started.complete();
          return response.future;
        }
        return reviewsRoute(r, role: role);
      }),
    );
    addTearDown(vm.dispose);
    await vm.initialize();
    await vm.openAccount();
    final pending = vm.account.openReviews();
    await started.future;
    role = 'homeowner';
    await vm.refresh();
    response.complete(base.jsonResponse(page()));
    await pending;
    expect(vm.reviews.page, isNull);
    expect(vm.account.showingReviews, isFalse);
  });
  test('late oldowner401 does not expire new scope', () async {
    final response = Completer<http.Response>();
    var expired = 0;
    final vm = ReviewsModel(
      repository(
        base.FakeAuth()..active = true,
        MockClient((r) => response.future),
      ),
      onSessionExpired: () => expired++,
    );
    addTearDown(vm.dispose);
    vm.setOwner('u1');
    final pending = vm.load();
    vm.setOwner('u2');
    response.complete(http.Response('', 401));
    await pending;
    expect(expired, 0);
    expect(vm.page, isNull);
  });
}
