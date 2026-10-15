<!-- IMPORT emails/partials/header.tpl -->

<!-- Email Body : BEGIN -->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width: 600px;">

	<!-- 1 Column Text + Button : BEGIN -->
	<tr>
		<td bgcolor="#0d0d0f">
			<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
				<tr>
					<td style="padding: 40px 40px 6px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<h1 style="margin: 0; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 24px; line-height: 27px; color: #ffffff; font-weight: 800;">{{tx("email:greeting-no-name")}}</h1>
					</td>
				</tr>
				<tr>
					<td style="padding: 0px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<h1 style="margin: 0 0 10px 0; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 18px; line-height: 21px; color: #b4b4bd; font-weight: 800;">{{tx("email:reset.text1")}}</h1>
					</td>
				</tr>
				<tr>
					<td style="padding: 20px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<p style="margin: 0;">
							{{tx("email:reset.text2")}}
						</p>
					</td>
				</tr>
				<tr>
					<td style="padding: 32px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<!-- Button : BEGIN -->
						<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: auto;">
							<tr>
								<td style="border-radius: 999px; background: #ffffff; text-align: center;" class="button-td">
									<a href="{reset_link}" style="background: #ffffff; border: 15px solid #ffffff; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 13px; line-height: 1.1; text-align: center; text-decoration: none; display: block; border-radius: 999px; font-weight: bold;" class="button-a">
										<span style="color:#000000;" class="button-link">{{tx("email:reset.cta")}} &rarr;</span>
									</a>
								</td>
							</tr>
						</table>
						<!-- Button : END -->
					</td>
				</tr>
			</table>
		</td>
	</tr>
	<!-- 1 Column Text + Button : END -->

</table>
<!-- Email Body : END -->

<!-- IMPORT emails/partials/footer.tpl -->
