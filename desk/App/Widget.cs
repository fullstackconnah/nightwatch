using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Win32;
using NightwatchDesk.Core;

namespace NightwatchDesk.App;

/// <summary>The borderless tool window (SHAPE "Placement"): never in Alt+Tab, never activated by itself, remembers where it was dragged.</summary>
internal sealed class Widget : Window
{
    const double Inset = 16; // sp-lg

    readonly DeskView view;
    WinState state;
    bool bottomAnchor;

    public event Action<bool>? PointerOver, FocusInside;
    public event Action? Touched, ContextMenuRequested;

    public bool AlwaysOnTop => Topmost;

    public Widget(DeskView view, WinState? saved)
    {
        this.view = view;
        state = saved ?? new WinState(double.NaN, double.NaN, "top", false, null);
        Topmost = state.AlwaysOnTop;
        bottomAnchor = state.Anchor == "bottom";

        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        ShowActivated = false;
        AllowsTransparency = true; // grayscale text, accepted: the live window then renders like the offscreen snapshot
        Background = Brushes.Transparent;
        SizeToContent = SizeToContent.Height;
        Width = Theme.D("win-width");
        Title = "Nightwatch Desk";
        AutomationProperties.SetName(this, "Nightwatch Desk");
        UseLayoutRounding = true;
        Content = view;

        Place();
        SourceInitialized += (_, _) =>
        {
            var h = new WindowInteropHelper(this).Handle;
            Native.SetWindowLong(h, Native.GwlExStyle, (IntPtr)(Native.GetWindowLong(h, Native.GwlExStyle).ToInt64() | Native.WsExToolWindow));
            SendToBottom();
        };
        Deactivated += (_, _) => SendToBottom();
        SizeChanged += OnSizeChanged;
        MouseEnter += (_, _) => PointerOver?.Invoke(true);
        MouseLeave += (_, _) => PointerOver?.Invoke(false);
        PreviewMouseMove += (_, _) => Touched?.Invoke();
        PreviewKeyDown += (_, _) => Touched?.Invoke();
        IsKeyboardFocusWithinChanged += (_, e) => FocusInside?.Invoke((bool)e.NewValue);
        PreviewMouseLeftButtonDown += OnDown;
        MouseRightButtonUp += (_, _) => ContextMenuRequested?.Invoke();
        SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
        IsVisibleChanged += (_, _) => VisibilityChanged?.Invoke();
        StateChanged += (_, _) => VisibilityChanged?.Invoke();
        Closed += (_, _) => SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
    }

    /// <summary>The window was shown, hidden, minimised or restored.</summary>
    public event Action? VisibilityChanged;
    /// <summary>The monitors changed; the fit-fold measures again.</summary>
    public event Action? DisplayChanged;

    public bool IsHiddenOrMinimised => !IsVisible || WindowState == WindowState.Minimized;
    public bool CameraCollapsed => state.CameraCollapsed;

    /// <summary>The user's own collapse choice; saved with the position through the one Save path.</summary>
    public void SetCameraCollapsed(bool collapsed)
    {
        state = state with { CameraCollapsed = collapsed };
        Save();
    }

    /// <summary>Height of the work area of the monitor the window is on, in DIP. Falls back to the primary one.</summary>
    public double WorkHeight()
    {
        var box = new Box(Left, Top, Width, CurrentHeight());
        var work = WorkAreas().FirstOrDefault(w => w.Contains(box));
        return work.Width > 0 ? work.Height : Primary().Height;
    }

    public double DpiScale => Scale;

    public void SetAlwaysOnTop(bool on)
    {
        Topmost = on;
        if (!on) SendToBottom();
        Save();
    }

    /// <summary>The way in from the tray (Enter after Win+B works too): show, bring forward, focus row 1.</summary>
    public void Summon()
    {
        Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        view.FirstRow?.Focus();
    }

    void SendToBottom()
    {
        if (Topmost) return;
        var h = new WindowInteropHelper(this).Handle;
        if (h != IntPtr.Zero) Native.SetWindowPos(h, Native.HwndBottom, 0, 0, 0, 0, Native.SwpNoSize | Native.SwpNoMove | Native.SwpNoActivate);
    }

    void OnDown(object sender, MouseButtonEventArgs e)
    {
        for (var o = e.OriginalSource as DependencyObject; o is not null; o = o is Visual ? VisualTreeHelper.GetParent(o) : LogicalTreeHelper.GetParent(o))
            if (o is Button) return; // a row is a click, anywhere else drags
        try { DragMove(); } catch (InvalidOperationException) { return; }
        Save();
    }

    // The shape grows down from a top anchor and up from a bottom one, so the pinned edge never moves.
    void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (!IsLoaded || e.PreviousSize.Height <= 0 || !e.HeightChanged) return;
        if (bottomAnchor) Top -= e.NewSize.Height - e.PreviousSize.Height;
        Clamp();
    }

    void OnDisplayChanged(object? s, EventArgs e) => Dispatcher.BeginInvoke((Action)(() => { Clamp(); DisplayChanged?.Invoke(); }));

    double Scale => VisualTreeHelper.GetDpi(this).DpiScaleX;

    // shortcut: pixel work areas are converted with this window's own DPI scale, so a saved spot can be a few DIPs off after crossing monitors of different DPI; Windows corrects it on DpiChanged.
    IReadOnlyList<Box> WorkAreas() => System.Windows.Forms.Screen.AllScreens
        .Select(s => new Box(s.WorkingArea.Left / Scale, s.WorkingArea.Top / Scale, s.WorkingArea.Width / Scale, s.WorkingArea.Height / Scale)).ToList();

    Box Primary()
    {
        var p = System.Windows.Forms.Screen.PrimaryScreen!.WorkingArea;
        return new Box(p.Left / Scale, p.Top / Scale, p.Width / Scale, p.Height / Scale);
    }

    double CurrentHeight()
    {
        if (ActualHeight > 0) return ActualHeight;
        view.Measure(new Size(Width, double.PositiveInfinity));
        return view.DesiredSize.Height;
    }

    void Place()
    {
        var h = CurrentHeight();
        var box = double.IsNaN(state.Left) ? Placement.Default(Primary(), Width, h, Inset) : new Box(state.Left, state.Top, Width, h);
        Apply(Placement.Clamp(box, WorkAreas(), Primary(), Inset));
        WindowStartupLocation = WindowStartupLocation.Manual;
    }

    void Clamp()
    {
        var box = new Box(Left, Top, Width, CurrentHeight());
        Apply(Placement.Clamp(box, WorkAreas(), Primary(), Inset));
    }

    void Apply(Box b) { Left = b.Left; Top = b.Top; }

    public void Save()
    {
        var box = new Box(Left, Top, Width, CurrentHeight());
        var work = WorkAreas().FirstOrDefault(w => w.Contains(box));
        bottomAnchor = work.Width > 0 && !Placement.GrowsDown(box, work);
        state = state with { Left = Left, Top = Top, Anchor = bottomAnchor ? "bottom" : "top", AlwaysOnTop = Topmost, WorkArea = work.Width > 0 ? work : null };
        state.Save(DeskFiles.State);
    }
}
