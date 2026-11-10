using System.Windows.Forms;
using NightwatchDesk.Core;

namespace NightwatchDesk.App;

/// <summary>The NotifyIcon, its menu (Windows' own look, not restyled) and balloon toasts.</summary>
internal sealed class Tray : IDisposable
{
    readonly NotifyIcon icon = new();
    readonly ContextMenuStrip menu = new();
    readonly ToolStripMenuItem startup = new("Start with Windows");
    readonly ToolStripMenuItem onTop = new("Always on top");
    TrayKind? shown;

    public event Action? Summon, OpenHome, Refresh, Quit, MenuOpened, MenuClosed, ToastClicked;
    public event Action<bool>? StartupToggled, OnTopToggled;

    public Tray(bool alwaysOnTop)
    {
        menu.Items.Add("Open nightwatch", null, (_, _) => OpenHome?.Invoke());
        menu.Items.Add("Refresh", null, (_, _) => Refresh?.Invoke());
        menu.Items.Add(new ToolStripSeparator());
        startup.Click += (_, _) => StartupToggled?.Invoke(!startup.Checked);
        onTop.Checked = alwaysOnTop;
        onTop.Click += (_, _) => { onTop.Checked = !onTop.Checked; OnTopToggled?.Invoke(onTop.Checked); };
        menu.Items.Add(startup);
        menu.Items.Add(onTop);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit", null, (_, _) => Quit?.Invoke());
        menu.Opening += (_, _) => { startup.Checked = Autostart.Enabled; MenuOpened?.Invoke(); };
        menu.Closed += (_, _) => MenuClosed?.Invoke();

        icon.ContextMenuStrip = menu;
        icon.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) Summon?.Invoke(); };
        icon.BalloonTipClicked += (_, _) => ToastClicked?.Invoke();
        icon.Visible = true;
    }

    public void Set(TrayKind kind, string tooltip)
    {
        if (shown != kind)
        {
            shown = kind;
            icon.Icon = TrayIcon.Icon(kind, SystemInformation.SmallIconSize.Width);
        }
        var t = Copy.Trim(tooltip, Copy.TooltipMax);
        if (icon.Text != t) icon.Text = t;
    }

    public void Toast(Toast t)
    {
        icon.BalloonTipTitle = Copy.Trim(t.Title, Copy.ToastTitleMax);
        icon.BalloonTipText = Copy.Trim(t.Text, Copy.ToastTextMax);
        icon.BalloonTipIcon = ToolTipIcon.None;
        icon.ShowBalloonTip(10000);
    }

    /// <summary>The same menu from a right-click on the widget.</summary>
    public void ShowMenu() => menu.Show(Cursor.Position);

    public void Dispose()
    {
        icon.Visible = false;
        icon.Dispose();
        menu.Dispose();
    }
}
