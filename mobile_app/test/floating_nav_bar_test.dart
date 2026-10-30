import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show ScrollDirection;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:basak_mobile/core/ui/tokens.dart';
import 'package:basak_mobile/core/widgets/floating_glass_nav_bar.dart';

/// The student / supervisor shell in miniature: a scrolling tab body (with a
/// horizontal strip at the top) and the floating bar, wired the same way.
/// The bar shows icons only; scrolling down shrinks it onto the current tab.
class _Shell extends StatefulWidget {
  final int rows;
  const _Shell({this.rows = 60});

  @override
  State<_Shell> createState() => _ShellState();
}

class _ShellState extends State<_Shell> {
  int _currentIndex = 0;
  bool _navCollapsed = false;

  void _selectTab(int index) => setState(() {
        _currentIndex = index;
        _navCollapsed = false;
      });

  bool _onScroll(ScrollNotification notification) {
    final collapse = FloatingGlassNavBar.collapseOnScroll(notification);
    if (collapse != null && collapse != _navCollapsed) {
      setState(() => _navCollapsed = collapse);
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      body: NotificationListener<ScrollNotification>(
        onNotification: _onScroll,
        child: ListView(
          key: const Key('body'),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(
              height: 80,
              child: ListView(
                key: const Key('strip'),
                scrollDirection: Axis.horizontal,
                children: [for (var i = 0; i < 20; i++) SizedBox(width: 120, child: Text('بطاقة $i'))],
              ),
            ),
            TextButton(onPressed: () => _selectTab(2), child: const Text('افتح المسح')),
            for (var i = 0; i < widget.rows; i++) SizedBox(height: 48, child: Text('صف $i')),
          ],
        ),
      ),
      bottomNavigationBar: FloatingGlassNavBar(
        currentIndex: _currentIndex,
        onTabSelected: _selectTab,
        items: FloatingGlassNavBar.supervisorNavItems,
        collapsed: _navCollapsed,
      ),
    );
  }
}

Widget _app({int rows = 60, TextDirection direction = TextDirection.rtl}) => MaterialApp(
      home: Directionality(textDirection: direction, child: _Shell(rows: rows)),
    );

void _phoneAsks(WidgetTester tester, {bool lessMotion = false, bool moreContrast = false}) {
  tester.platformDispatcher.accessibilityFeaturesTestValue =
      FakeAccessibilityFeatures(disableAnimations: lessMotion, highContrast: moreContrast);
  addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
}

int _selected(WidgetTester tester) =>
    tester.widget<FloatingGlassNavBar>(find.byType(FloatingGlassNavBar)).currentIndex;

Rect _bar(WidgetTester tester) => tester.getRect(find.byKey(const Key('nav-pill')));

final _items = FloatingGlassNavBar.supervisorNavItems;
Finder _tab(int index) => find.byKey(Key('nav-tab-$index'));

void main() {
  testWidgets('icons only: no labels on the bar', (tester) async {
    await tester.pumpWidget(_app());
    for (final item in _items) {
      expect(find.byIcon(item.icon), findsOneWidget);
      expect(find.text(item.label), findsNothing, reason: '${item.label}: the bar shows icons only');
    }
  });

  testWidgets('scrolling down shrinks the bar onto the current tab; up restores it', (tester) async {
    await tester.pumpWidget(_app());
    final screenWidth = tester.view.physicalSize.width / tester.view.devicePixelRatio;
    final fullWidth = screenWidth - 2 * FloatingGlassNavBar.sideMargin;
    expect(_bar(tester).size, Size(fullWidth, FloatingGlassNavBar.height));

    await tester.drag(find.byKey(const Key('body')), const Offset(0, -300));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 175));
    // Mid-animation: narrower and shorter than the open bar, never overflowing.
    expect(_bar(tester).width, lessThan(fullWidth));
    await tester.pumpAndSettle();

    // Collapsed: a small pill, as tall as the collapsed bar, around the current tab.
    expect(_bar(tester).height, FloatingGlassNavBar.collapsedHeight);
    expect(_bar(tester).width, lessThan(FloatingGlassNavBar.collapsedHeight * 2));
    expect(_bar(tester).contains(tester.getCenter(find.byIcon(_items[0].icon))), isTrue,
        reason: 'the current tab is inside the shrunk pill');

    await tester.drag(find.byKey(const Key('body')), const Offset(0, 120));
    await tester.pumpAndSettle();
    expect(_bar(tester).size, Size(fullWidth, FloatingGlassNavBar.height));
  });

  testWidgets('choosing a tab from the page expands the bar onto it', (tester) async {
    await tester.pumpWidget(_app());
    await tester.drag(find.byKey(const Key('body')), const Offset(0, -60));
    await tester.pumpAndSettle();
    expect(_bar(tester).height, FloatingGlassNavBar.collapsedHeight);

    await tester.tap(find.text('افتح المسح'));
    await tester.pumpAndSettle();
    expect(_selected(tester), 2);
    expect(_bar(tester).height, FloatingGlassNavBar.height);
  });

  testWidgets('every tab is at least 48 wide and tall when open', (tester) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_app());
    for (var i = 0; i < _items.length; i++) {
      final size = tester.getSize(_tab(i));
      expect(size.width, greaterThanOrEqualTo(48), reason: _items[i].label);
      expect(size.height, greaterThanOrEqualTo(48), reason: _items[i].label);
    }
  });

  testWidgets('the ink lens sits behind the selected tab and slides to the one that is chosen', (tester) async {
    await tester.pumpWidget(_app());
    Rect pill() => tester.getRect(find.byKey(const Key('nav-indicator')));
    double centre(int index) => tester.getCenter(find.byIcon(_items[index].icon)).dx;

    expect(pill().center.dx, moreOrLessEquals(centre(0), epsilon: .5));
    expect(pill().size, _restingLens(tester));

    await tester.tap(_tab(2));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 175));
    expect(pill().center.dx, lessThan(centre(0)));
    expect(pill().center.dx, greaterThan(centre(2)));
    await tester.pumpAndSettle();
    expect(pill().center.dx, moreOrLessEquals(centre(2), epsilon: .5));
    expect(pill().contains(tester.getCenter(find.byIcon(_items[2].icon))), isTrue);
  });

  testWidgets('the lens covers the whole selected tab and its icon', (tester) async {
    await tester.pumpWidget(_app());
    final lens = tester.getRect(find.byKey(const Key('nav-indicator')));
    final icon = tester.getRect(find.byIcon(_items[0].icon));
    expect(lens.contains(icon.topLeft) && lens.contains(icon.bottomRight), isTrue, reason: 'the icon is under it');
    expect(lens.overlaps(tester.getRect(find.byIcon(_items[1].icon))), isFalse);
  });

  group('the glass and its lens', () {
    Rect lens(WidgetTester tester) => tester.getRect(find.byKey(const Key('nav-indicator')));
    double centre(WidgetTester tester, int index) => tester.getCenter(find.byIcon(_items[index].icon)).dx;

    testWidgets('the bar is glass over the page, in a layer of its own', (tester) async {
      await tester.pumpWidget(_app());
      expect(find.byKey(const Key('nav-glass')), findsOneWidget);
      expect(find.byKey(const Key('nav-solid')), findsNothing);
      expect(find.descendant(of: find.byType(FloatingGlassNavBar), matching: find.byType(RepaintBoundary)),
          findsWidgets);
    });

    testWidgets('the lens stretches on its way, lands a little past its tab and settles at its own size',
        (tester) async {
      await tester.pumpWidget(_app());
      await tester.tap(_tab(3));
      await tester.pump();
      var widest = 0.0;
      var furthest = double.infinity;
      for (var i = 0; i < 60; i++) {
        await tester.pump(const Duration(milliseconds: 16));
        widest = widest < lens(tester).width ? lens(tester).width : widest;
        furthest = furthest > lens(tester).center.dx ? lens(tester).center.dx : furthest;
      }
      expect(widest, greaterThan(_restingLens(tester).width + 4), reason: 'longer while it travels');
      expect(furthest, lessThan(centre(tester, 3)));
      await tester.pumpAndSettle();
      expect(lens(tester).size, _restingLens(tester));
      expect(lens(tester).center.dx, moreOrLessEquals(centre(tester, 3), epsilon: .5));
    });

    testWidgets('the icon under the lens is white and full size; the others are quiet and a little smaller',
        (tester) async {
      await tester.pumpWidget(_app());
      Icon icon(int index) => tester.widget<Icon>(find.byIcon(_items[index].icon));
      double scale(int index) => tester
          .widget<Transform>(find.ancestor(of: find.byIcon(_items[index].icon), matching: find.byType(Transform)).first)
          .transform
          .entry(0, 0);
      expect(icon(0).color, BasakPalette.surface);
      expect(icon(1).color, BasakPalette.ink);
      expect(scale(0), 1);
      expect(scale(1), lessThan(1));

      await tester.tap(_tab(1));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 60));
      expect(icon(0).color, isNot(anyOf(BasakPalette.surface, BasakPalette.ink)));
      expect(icon(1).color, isNot(anyOf(BasakPalette.surface, BasakPalette.ink)));
      await tester.pumpAndSettle();
      expect(icon(1).color, BasakPalette.surface);
      expect(icon(0).color, BasakPalette.ink);
    });

    testWidgets('a tab change clicks', (tester) async {
      final haptics = <String?>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'HapticFeedback.vibrate') haptics.add(call.arguments as String?);
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      await tester.pumpWidget(_app());
      await tester.tap(_tab(1));
      await tester.pumpAndSettle();
      expect(haptics, ['HapticFeedbackType.selectionClick']);
    });

    testWidgets('reduce motion: the lens is simply on the chosen tab, with no spring and no stretch',
        (tester) async {
      _phoneAsks(tester, lessMotion: true);
      await tester.pumpWidget(_app());
      await tester.tap(_tab(2));
      await tester.pump();
      expect(lens(tester).center.dx, moreOrLessEquals(centre(tester, 2), epsilon: .5));
      expect(lens(tester).size, _restingLens(tester));
      expect(_selected(tester), 2);
    });

    testWidgets('increase contrast (or reduce transparency): the solid white bar, with no blur', (tester) async {
      _phoneAsks(tester, moreContrast: true);
      await tester.pumpWidget(_app());
      expect(find.byType(BackdropFilter), findsNothing);
      expect(find.byKey(const Key('nav-solid')), findsOneWidget);
      await tester.tap(_tab(1));
      await tester.pumpAndSettle();
      expect(_selected(tester), 1);
      expect(lens(tester).center.dx, moreOrLessEquals(centre(tester, 1), epsilon: .5));

      tester.platformDispatcher.clearAccessibilityFeaturesTestValue();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('nav-glass')), findsOneWidget);
      BasakGlass.reduceTransparency.value = true;
      addTearDown(() => BasakGlass.reduceTransparency.value = false);
      await tester.pump();
      expect(find.byType(BackdropFilter), findsNothing);
    });

    testWidgets('a page that must not pay for a blur can ask for the solid bar', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          bottomNavigationBar:
              FloatingGlassNavBar(currentIndex: 0, onTabSelected: (_) {}, items: _items, glass: false),
        ),
      ));
      expect(find.byType(BackdropFilter), findsNothing);
    });

    testWidgets('a drag along the bar carries the lens and chooses the tab it is let go on', (tester) async {
      await tester.pumpWidget(_app());
      final from = tester.getCenter(find.byIcon(_items[0].icon));
      final to = tester.getCenter(find.byIcon(_items[2].icon));
      final gesture = await tester.startGesture(from);
      await gesture.moveTo(Offset((from.dx + to.dx) / 2, from.dy));
      await tester.pump();
      await gesture.moveTo(to);
      await tester.pump();
      expect(_selected(tester), 0, reason: 'nothing is chosen until the finger lifts');
      expect(lens(tester).center.dx, moreOrLessEquals(to.dx, epsilon: 1), reason: 'the lens is under the finger');
      await gesture.up();
      await tester.pumpAndSettle();
      expect(_selected(tester), 2);
      expect(lens(tester).center.dx, moreOrLessEquals(centre(tester, 2), epsilon: .5));

      final back = await tester.startGesture(to);
      await back.moveTo(Offset(to.dx + (from.dx - to.dx) * .2, to.dy + 2));
      await tester.pump();
      await back.moveTo(Offset(to.dx + (from.dx - to.dx) * .3, to.dy));
      await back.up();
      await tester.pumpAndSettle();
      expect(_selected(tester), 1, reason: '0.6 of a tab away from the third: the second is nearer');
      expect(lens(tester).center.dx, moreOrLessEquals(centre(tester, _selected(tester)), epsilon: .5));
    });

    testWidgets('left to right the lens follows the same tabs, mirrored', (tester) async {
      await tester.pumpWidget(_app(direction: TextDirection.ltr));
      expect(centre(tester, 0), lessThan(centre(tester, 3)));
      expect(lens(tester).center.dx, moreOrLessEquals(centre(tester, 0), epsilon: .5));
      await tester.tap(_tab(3));
      await tester.pumpAndSettle();
      expect(lens(tester).center.dx, moreOrLessEquals(centre(tester, 3), epsilon: .5));
    });
  });

  testWidgets('horizontal scrolls leave the bar alone; a page too short to scroll is open at rest', (tester) async {
    await tester.pumpWidget(_app());
    final screenWidth = tester.view.physicalSize.width / tester.view.devicePixelRatio;
    final fullWidth = screenWidth - 2 * FloatingGlassNavBar.sideMargin;
    await tester.drag(find.byKey(const Key('strip')), const Offset(300, 0));
    await tester.drag(find.byKey(const Key('strip')), const Offset(-300, 0));
    await tester.pumpAndSettle();
    expect(_bar(tester).width, fullWidth);

    await tester.pumpWidget(_app(rows: 1));
    final pull = await tester.startGesture(tester.getCenter(find.byKey(const Key('body'))));
    await pull.moveBy(const Offset(0, -40));
    await pull.moveBy(const Offset(0, -160));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(_bar(tester).width, lessThan(fullWidth));
    await pull.up();
    await tester.pumpAndSettle();
    expect(_bar(tester).width, fullWidth);
  });

  testWidgets('coming to rest at the top expands the bar', (tester) async {
    await tester.pumpWidget(_app());
    final context = tester.element(find.byKey(const Key('body')));
    UserScrollNotification at(double pixels, ScrollDirection direction) => UserScrollNotification(
          metrics: FixedScrollMetrics(
            minScrollExtent: 0,
            maxScrollExtent: 2000,
            pixels: pixels,
            viewportDimension: 600,
            axisDirection: AxisDirection.down,
            devicePixelRatio: 1,
          ),
          context: context,
          direction: direction,
        );

    expect(FloatingGlassNavBar.collapseOnScroll(at(0, ScrollDirection.idle)), isFalse);
    expect(FloatingGlassNavBar.collapseOnScroll(at(400, ScrollDirection.idle)), isNull);
    expect(FloatingGlassNavBar.collapseOnScroll(at(0, ScrollDirection.reverse)), isTrue);
    expect(FloatingGlassNavBar.collapseOnScroll(at(400, ScrollDirection.forward)), isFalse);
  });
}

/// The lens at rest: as wide as a tab less a hair, as tall as the bar less its inset.
Size _restingLens(WidgetTester tester) {
  final bar = tester.getSize(find.byKey(const Key('nav-pill')));
  return Size((bar.width - 16) / 4 - 4, bar.height - 12);
}
