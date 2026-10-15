			<!-- Closet Republic email footer. Made from NodeBB 4.16.3's emails/partials/footer.tpl. -->
			<!-- The prism stripe again, closing the message. -->
			<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width: 600px;">
				<tr>
					<td height="4" bgcolor="#ff978f" style="height: 4px; font-size: 0; line-height: 0; background: #ff978f;">&nbsp;</td>
					<td height="4" bgcolor="#ffb47f" style="height: 4px; font-size: 0; line-height: 0; background: #ffb47f;">&nbsp;</td>
					<td height="4" bgcolor="#ffe680" style="height: 4px; font-size: 0; line-height: 0; background: #ffe680;">&nbsp;</td>
					<td height="4" bgcolor="#94e3b0" style="height: 4px; font-size: 0; line-height: 0; background: #94e3b0;">&nbsp;</td>
					<td height="4" bgcolor="#8cc2ff" style="height: 4px; font-size: 0; line-height: 0; background: #8cc2ff;">&nbsp;</td>
					<td height="4" bgcolor="#aa9fff" style="height: 4px; font-size: 0; line-height: 0; background: #aa9fff;">&nbsp;</td>
					<td height="4" bgcolor="#e09fff" style="height: 4px; font-size: 0; line-height: 0; background: #e09fff;">&nbsp;</td>
				</tr>
			</table>
			<!-- Email Footer : BEGIN -->
			<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width: 680px;">
				<tr>
					<td style="padding: 32px 10px 40px; width: 100%; font-size: 12px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; line-height: 18px; text-align: center; color: #b4b4bd;">
						<strong style="color: #ffffff;">Closet Republic · Naturally exceptional</strong>
						<br>
						A parody micronation and online community. No trackers, no ads.
						{{{ if showUnsubscribe }}}
						<br><br>
						{{tx("email:notif.post.unsub.info")}} <a href="{url}/uid/{uid}/settings" style="color: #ffffff; text-decoration: underline;">{{tx("email:unsub.cta")}}</a>.
						<br />{{tx("email:notif.post.unsub.one-click")}} <a href="{unsubUrl}" style="color: #ffffff; text-decoration: underline;">{{tx("email:unsubscribe")}}</a>.
						{{{ end }}}
						<br><br>
						<a href="https://amayakulkarni.com" style="color: #b4b4bd; text-decoration: underline;">Created by amaya@veronami</a>
					</td>
				</tr>
			</table>
			<!-- Email Footer : END -->

			<!--[if mso]>
			</td>
			</tr>
			</table>
			<![endif]-->
		</div>

	</center>
</body>

</html>
